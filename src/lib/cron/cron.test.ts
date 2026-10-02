import { afterEach, describe, expect, it, vi } from "vitest";
import { isAuthorizedCron } from "./authorize";
import { createCronHandler, type CronHandlerDeps, type CronHandlerOptions } from "./handler";
import { errorCode, formatLog, sanitizeLogFields } from "./log";
import {
  CronConfigError,
  CronParamError,
  DEFAULT_BATCH,
  parseCronParams,
  type CronEnvironment,
} from "./params";
import { runJob, type JobContext, type JobDefinition, type JobRunStore } from "./run";
import { createStepRunner } from "./steps";

const SECRET = "test-cron-secret-test-cron-secret-0001";
const WEDDING = "0b6a1c1e-3b5e-4d0c-9a1f-0d3c7e9a1b11";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("autorizace cronu", () => {
  it("přijme jen přesnou hlavičku Bearer s tajnou hodnotou", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it.each([
    ["bez hlavičky", null],
    ["prázdná hlavička", ""],
    ["jiná tajná hodnota", "Bearer jina-tajna-hodnota-jina-tajna-hodnota-02"],
    ["bez schématu", SECRET],
    ["jiné schéma", `Basic ${SECRET}`],
    ["malá písmena schématu", `bearer ${SECRET}`],
    ["s mezerou na konci", `Bearer ${SECRET} `],
    ["o znak kratší", `Bearer ${SECRET.slice(0, -1)}`],
    ["o znak delší", `Bearer ${SECRET}x`],
  ])("odmítne: %s", (_name, header) => {
    expect(isAuthorizedCron(header, SECRET)).toBe(false);
  });

  it("bez nastavené tajné hodnoty se nikdo neautorizuje (ani prázdnou hlavičkou)", () => {
    expect(isAuthorizedCron("Bearer ", undefined)).toBe(false);
    expect(isAuthorizedCron("", undefined)).toBe(false);
    expect(isAuthorizedCron(null, undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer undefined", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
  });
});

describe("parametry cronu", () => {
  const real = new Date("2026-10-02T03:17:00Z");
  const prod: CronEnvironment = { testClock: false, production: true, realNow: () => real };
  const test: CronEnvironment = { testClock: true, production: false, realNow: () => real };
  const parse = (query: string, environment = prod) =>
    parseCronParams(new URLSearchParams(query), environment);

  it("výchozí hodnoty: ostrý běh se skutečným časem a výchozí dávkou", () => {
    expect(parse("")).toEqual({
      dryRun: false,
      batch: DEFAULT_BATCH,
      weddingId: null,
      now: real,
      clockInjected: false,
    });
  });

  it.each([
    ["dry_run=1", true],
    ["dry_run=true", true],
    ["dry_run=0", false],
    ["dry_run=false", false],
  ])("%s", (query, expected) => {
    expect(parse(query).dryRun).toBe(expected);
  });

  it.each(["dry_run=yes", "dry_run=", "dry_run=2"])("neplatné %s je chyba 400", (query) => {
    expect(() => parse(query)).toThrow(CronParamError);
  });

  it.each(["batch=0", "batch=-1", "batch=501", "batch=abc", "batch=1.5", "batch="])(
    "neplatná dávka %s se odmítne",
    (query) => {
      expect(() => parse(query)).toThrow(/invalid_batch/);
    },
  );

  it("dávka 1 až 500 projde", () => {
    expect(parse("batch=1").batch).toBe(1);
    expect(parse("batch=500").batch).toBe(500);
  });

  it("wedding_id musí být UUID a převádí se na malá písmena", () => {
    expect(parse(`wedding_id=${WEDDING.toUpperCase()}`).weddingId).toBe(WEDDING);
    expect(() => parse("wedding_id=klara-a-matej")).toThrow(/invalid_wedding_id/);
    expect(() => parse("wedding_id=' or 1=1")).toThrow(/invalid_wedding_id/);
  });

  describe("simulovaný čas", () => {
    it("v ostrém prostředí je parametr now odmítnut", () => {
      expect(() => parse(`now=2030-01-01T00:00:00Z&wedding_id=${WEDDING}`)).toThrow(
        /now_not_allowed/,
      );
    });

    it("v testovacím prostředí vyžaduje wedding_id (simulace nesmí zasáhnout cizí svatby)", () => {
      expect(() => parse("now=2030-01-01T00:00:00Z", test)).toThrow(/wedding_id_required_with_now/);
    });

    it("v testovacím prostředí se se svatbou použije", () => {
      const params = parse(`now=2030-01-01T00:00:00Z&wedding_id=${WEDDING}`, test);
      expect(params.now.toISOString()).toBe("2030-01-01T00:00:00.000Z");
      expect(params.clockInjected).toBe(true);
    });

    it.each(["2030-01-01", "2030-01-01T00:00:00", "zítra", "1893456000", "2030-13-45T00:00:00Z"])(
      "neplatný čas %j se odmítne",
      (value) => {
        expect(() => parse(`now=${encodeURIComponent(value)}&wedding_id=${WEDDING}`, test)).toThrow(
          CronParamError,
        );
      },
    );

    it("zapnutá testovací hodina v produkci je chyba nasazení, ať se now předá, nebo ne", () => {
      const misconfigured: CronEnvironment = { testClock: true, production: true };
      expect(() => parse("", misconfigured)).toThrow(CronConfigError);
      expect(() => parse(`now=2030-01-01T00:00:00Z&wedding_id=${WEDDING}`, misconfigured)).toThrow(
        CronConfigError,
      );
    });
  });
});

describe("log bez osobních údajů", () => {
  it("řetězec podobný e-mailu se nahradí a neznámé typy a klíče se zahodí", () => {
    const fields = sanitizeLogFields({
      job: "retention",
      who: "jan@example.test",
      count: 3,
      ok: true,
      none: null,
      // @ts-expect-error objekty do logu nepatří
      nested: { email: "jan@example.test" },
      "Špatný klíč": "x",
      skipped: undefined,
    });
    expect(fields).toEqual({ job: "retention", who: "[redacted]", count: 3, ok: true, none: null });
    expect(JSON.stringify(fields)).not.toContain("example.test");
  });

  it("řádek je JSON s úrovní a událostí", () => {
    expect(
      JSON.parse(formatLog("info", "cron_finished", { job: "lifecycle", archived: 2 })),
    ).toEqual({
      level: "info",
      event: "cron_finished",
      job: "lifecycle",
      archived: 2,
    });
  });

  it("chyba se popíše názvem, funkcí a kódem, nikdy zprávou", () => {
    const error = Object.assign(new Error("duplicate key value violates (jan@example.test)"), {
      name: "DbError",
      fn: "purge_health_data",
      code: "23505",
    });
    expect(errorCode(error)).toBe("DbError:purge_health_data:23505");
    expect(errorCode(new Error("jan@example.test"))).toBe("Error");
    expect(errorCode("text")).toBe("UnknownError");
  });
});

describe("kroky úlohy", () => {
  it("selhání jednoho kroku nezastaví ostatní a výsledek je partial", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runner = createStepRunner("test");
    await runner.step("a", async () => 1);
    await runner.step("b", async () => {
      throw Object.assign(new Error("x"), { name: "DbError", fn: "f", code: "42501" });
    });
    await runner.step("c", async () => 3);
    expect(runner.result()).toMatchObject({ status: "partial", errorCode: "b:DbError:f:42501" });
  });

  it("neprošel žádný krok = failed, bez chyby = ok, odložená práce = partial", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = createStepRunner("test");
    await failing.step("a", async () => {
      throw new Error("x");
    });
    expect(failing.result().status).toBe("failed");

    const fine = createStepRunner("test");
    await fine.step("a", async () => 1);
    expect(fine.result().status).toBe("ok");

    const deferred = createStepRunner("test");
    await deferred.step("a", async () => 1);
    deferred.deferred();
    expect(deferred.result()).toMatchObject({ status: "partial", counts: { deferred: 1 } });
  });
});

function memoryStore(options: { locked?: boolean; failFinish?: boolean } = {}) {
  const finished: Array<{ status: string; counts: Record<string, number>; code?: string }> = [];
  const store: JobRunStore = {
    async start() {
      return options.locked ? null : "run-1";
    },
    async finish(_id, status, counts, code) {
      if (options.failFinish) throw new Error("finish");
      finished.push({ status, counts, code });
    },
  };
  return { store, finished };
}

const context = (overrides: Partial<JobContext> = {}): JobContext => ({
  now: new Date("2026-10-02T03:17:00Z"),
  dryRun: false,
  batch: 10,
  weddingId: null,
  timeLeftMs: () => 10_000,
  ...overrides,
});

const okJob: JobDefinition = {
  name: "lifecycle",
  run: vi.fn(async () => ({ status: "ok" as const, counts: { archived: 2 } })),
};

describe("běh úlohy", () => {
  it("zapíše výsledek běhu a vrátí počty", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { store, finished } = memoryStore();
    const report = await runJob(okJob, context(), store);
    expect(report).toMatchObject({ job: "lifecycle", status: "ok", counts: { archived: 2 } });
    expect(finished).toEqual([{ status: "ok", counts: { archived: 2 }, code: undefined }]);
  });

  it("souběžný běh (zámek drží jiný) se přeskočí a nic se nespustí", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const job: JobDefinition = { name: "retention", run: vi.fn() };
    const { store, finished } = memoryStore({ locked: true });
    const report = await runJob(job, context(), store);
    expect(report.status).toBe("skipped");
    expect(job.run).not.toHaveBeenCalled();
    expect(finished).toHaveLength(0);
  });

  it("výjimka úlohy se zapíše jako failed s kódem, ne se zprávou", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const job: JobDefinition = {
      name: "retention",
      run: async () => {
        throw Object.assign(new Error("jan@example.test"), { name: "DbError", fn: "x", code: "1" });
      },
    };
    const { store, finished } = memoryStore();
    const report = await runJob(job, context(), store);
    expect(report).toMatchObject({ status: "failed", errorCode: "DbError:x:1" });
    expect(finished[0]).toMatchObject({ status: "failed", code: "DbError:x:1" });
    expect(JSON.stringify(report)).not.toContain("example.test");
  });

  it("selhání zápisu výsledku úlohu neshodí", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { store } = memoryStore({ failFinish: true });
    expect((await runJob(okJob, context(), store)).status).toBe("ok");
  });

  it("dry_run nezapisuje běh ani nezamyká, jen vrátí počty", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const start = vi.fn();
    const report = await runJob(okJob, context({ dryRun: true }), {
      start,
      finish: vi.fn(),
    } as JobRunStore);
    expect(report).toMatchObject({ status: "dry_run", counts: { archived: 2 } });
    expect(start).not.toHaveBeenCalled();
  });
});

describe("obsluha cest /api/cron", () => {
  const environment = { secret: SECRET, testClock: false, production: false };

  function setup(
    options: Partial<CronHandlerOptions> = {},
    overrides: Partial<CronHandlerDeps> = {},
    job: JobDefinition = okJob,
  ) {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { store, finished } = memoryStore();
    const reportFailure = vi.fn();
    const handler = createCronHandler(
      { jobs: [job], allowTestClock: true, ...options },
      {
        environment: () => environment,
        store: () => store,
        reportFailure,
        budgetMs: 50_000,
        ...overrides,
      },
    );
    return { handler, finished, reportFailure };
  }
  const call = (handler: (r: Request) => Promise<Response>, query = "", header?: string) =>
    handler(
      new Request(`https://app.se-vezmou.cz/api/cron/lifecycle${query}`, {
        headers: header ? { authorization: header } : {},
      }),
    );

  it("bez hlavičky vrací 401 a úloha se nespustí", async () => {
    const run = vi.fn();
    const { handler, finished } = setup({}, {}, { name: "lifecycle", run });
    const response = await call(handler);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(run).not.toHaveBeenCalled();
    expect(finished).toHaveLength(0);
  });

  it("se špatnou tajnou hodnotou vrací 401", async () => {
    const run = vi.fn();
    const { handler } = setup({}, {}, { name: "lifecycle", run });
    expect((await call(handler, "", "Bearer spatne")).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("bez nastavené tajné hodnoty vrací 401 i pro hlavičku Bearer", async () => {
    const { handler } = setup({}, { environment: () => ({ ...environment, secret: undefined }) });
    expect((await call(handler, "", "Bearer ")).status).toBe(401);
    expect((await call(handler, "", `Bearer ${SECRET}`)).status).toBe(401);
  });

  it("se správnou hlavičkou úlohu spustí a vrátí jen počty", async () => {
    const { handler, finished } = setup();
    const response = await call(handler, "?batch=5", `Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      dry_run: false,
      jobs: [{ job: "lifecycle", status: "ok", counts: { archived: 2 } }],
    });
    expect(finished).toHaveLength(1);
  });

  it("dry_run spustí úlohu v režimu bez zápisu", async () => {
    const run = vi.fn(async (c: JobContext) => ({
      status: "ok" as const,
      counts: { dry: c.dryRun ? 1 : 0 },
    }));
    const { handler, finished } = setup({}, {}, { name: "lifecycle", run });
    const body = await (await call(handler, "?dry_run=1", `Bearer ${SECRET}`)).json();
    expect(body).toMatchObject({
      dry_run: true,
      jobs: [{ status: "dry_run", counts: { dry: 1 } }],
    });
    expect(finished).toHaveLength(0);
  });

  it("neplatný parametr vrací 400, now bez testovací hodiny 400", async () => {
    const { handler } = setup();
    expect((await call(handler, "?batch=0", `Bearer ${SECRET}`)).status).toBe(400);
    const response = await call(
      handler,
      `?now=2030-01-01T00:00:00Z&wedding_id=${WEDDING}`,
      `Bearer ${SECRET}`,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "now_not_allowed" });
  });

  it("simulovaný čas se v testovacím prostředí předá úloze", async () => {
    const run = vi.fn(async (c: JobContext) => ({
      status: "ok" as const,
      counts: { year: c.now.getUTCFullYear(), scoped: c.weddingId ? 1 : 0 },
    }));
    const { handler } = setup(
      {},
      { environment: () => ({ ...environment, testClock: true }) },
      { name: "lifecycle", run },
    );
    const body = await (
      await call(handler, `?now=2030-01-01T00:00:00Z&wedding_id=${WEDDING}`, `Bearer ${SECRET}`)
    ).json();
    expect(body.jobs[0].counts).toEqual({ year: 2030, scoped: 1 });
  });

  it("cesta bez podpory simulovaného času (úklid, denní běh) ho odmítne i v testech", async () => {
    const { handler } = setup(
      { allowTestClock: false },
      { environment: () => ({ ...environment, testClock: true }) },
    );
    const response = await call(
      handler,
      `?now=2030-01-01T00:00:00Z&wedding_id=${WEDDING}`,
      `Bearer ${SECRET}`,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "now_not_supported" });
  });

  it("testovací hodina v produkci: 500 a úloha neběží", async () => {
    const run = vi.fn();
    const { handler } = setup(
      {},
      { environment: () => ({ ...environment, testClock: true, production: true }) },
      { name: "lifecycle", run },
    );
    const response = await call(handler, "", `Bearer ${SECRET}`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "test_clock_in_production" });
    expect(run).not.toHaveBeenCalled();
  });

  it("selhání úlohy: 500 a hlášení do monitoringu jen s názvem a kódem", async () => {
    const job: JobDefinition = {
      name: "retention",
      run: async () => ({
        status: "failed",
        counts: {},
        errorCode: "DbError:purge_health_data:42501",
      }),
    };
    const { handler, reportFailure } = setup({}, {}, job);
    const response = await call(handler, "", `Bearer ${SECRET}`);
    expect(response.status).toBe(500);
    expect(reportFailure).toHaveBeenCalledWith("retention", "DbError:purge_health_data:42501");
  });

  it("částečný výsledek je 200 (další běh dokončí zbytek)", async () => {
    const job: JobDefinition = {
      name: "retention",
      run: async () => ({ status: "partial", counts: { storage_failed: 1 } }),
    };
    const { handler } = setup({}, {}, job);
    expect((await call(handler, "", `Bearer ${SECRET}`)).status).toBe(200);
  });

  it("více úloh běží za sebou ve sdíleném rozpočtu a každá má vlastní běh", async () => {
    const order: string[] = [];
    const make = (name: "retention" | "lifecycle" | "housekeeping"): JobDefinition => ({
      name,
      run: async (c) => {
        order.push(`${name}:${c.timeLeftMs() > 0}`);
        return { status: "ok", counts: {} };
      },
    });
    const { handler, finished } = setup({
      jobs: [make("retention"), make("lifecycle"), make("housekeeping")],
      allowTestClock: false,
    });
    const body = await (await call(handler, "", `Bearer ${SECRET}`)).json();
    expect(order).toEqual(["retention:true", "lifecycle:true", "housekeeping:true"]);
    expect(body.jobs.map((j: { job: string }) => j.job)).toEqual([
      "retention",
      "lifecycle",
      "housekeeping",
    ]);
    expect(finished).toHaveLength(3);
  });
});
