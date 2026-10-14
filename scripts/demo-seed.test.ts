import { describe, expect, it } from "vitest";
import {
  assertSafeTarget,
  describeTarget,
  isRemoteConfig,
  parseArgs,
  planLines,
  rpc,
} from "./demo-seed.mjs";
import { clientConfig } from "./db-migrate.mjs";
import {
  BACKUP_EMAIL,
  buildDoc,
  buildRsvpSettings,
  buildSeatingBase,
  DEMO_GIFTS,
  DEMO_HOUSEHOLDS,
  DEMO_PHOTOS,
  DEMO_VENDORS,
  demoId,
  generatePin,
  MIN_DAYS_AHEAD,
  QUICK_NOTICE,
  renderPhoto,
  resolveWeddingDate,
  seatHouseholds,
} from "./demo-seed-content";
import { docToPublic, translationGaps, validateDoc } from "../src/admin/site/doc";
import { pinProblem } from "../src/auth/pin-format";
import { blockTypes, publicContentSchema, sensitiveContentSchema } from "../src/site/types";
import { addDays, todayIn } from "../src/wizard/zoned";

type Env = Record<string, string | undefined>;
const ENV: Env = { DEMO_ADMIN_EMAIL: "Majitel@Example.cz" };
const parse = (argv: string[], env: Env = ENV) => parseArgs(argv, env);

describe("demo-seed: argumenty", () => {
  it("výchozí hodnoty, e-mail správce z prostředí malými písmeny", () => {
    expect(parse([])).toMatchObject({
      slug: "test-a-test",
      adminEmail: "majitel@example.cz",
      mode: "seed",
      yes: false,
    });
  });

  it("hodnoty volbou přepisují prostředí, podporují tvar --volba=hodnota", () => {
    const opts = parse([
      "--admin-email=jiny@example.cz",
      "--slug",
      "Demo-Web",
      "--date=+18m",
      "--yes",
    ]);
    expect(opts).toMatchObject({
      adminEmail: "jiny@example.cz",
      slug: "demo-web",
      date: "+18m",
      yes: true,
    });
  });

  it("PINy z prostředí i z voleb", () => {
    const env: Env = { ...ENV, DEMO_GUEST_PIN: "482915", DEMO_SITE_PIN: "739204" };
    expect(parse([], env)).toMatchObject({ guestPin: "482915", sitePin: "739204" });
    expect(parse(["--guest-pin", "135790"], env).guestPin).toBe("135790");
  });

  it("režimy: reset, delete; nelze obojí", () => {
    expect(parse(["--reset"]).mode).toBe("reset");
    expect(parse(["--delete"], {}).mode).toBe("delete");
    expect(() => parse(["--reset", "--delete"])).toThrow("nelze kombinovat");
  });

  it("odmítne chybějící e-mail správce (kromě --delete), neplatný e-mail, adresu, neznámý argument", () => {
    expect(() => parse([], {})).toThrow("e-mail správce");
    expect(() => parse(["--admin-email", "neni-email"])).toThrow("Neplatný e-mail");
    expect(() => parse(["--slug", "-spatne-"])).toThrow("Neplatná adresa");
    expect(() => parse(["--slug", "a--b"])).toThrow("Neplatná adresa");
    expect(() => parse(["--vsechno"])).toThrow("Neznámý argument");
    expect(() => parse(["--slug"])).toThrow("vyžaduje hodnotu");
    expect(() => parse(["--yes=1"])).toThrow("nemá hodnotu");
  });

  it("stejný PIN hostů a správy se odmítne", () => {
    expect(() => parse(["--guest-pin", "482915", "--site-pin", "482915"])).toThrow("různé");
  });

  it("nápověda nevyžaduje nic dalšího", () => {
    expect(parse(["--help"], {}).help).toBe(true);
  });
});

describe("demo-seed: ochrana před vzdálenou databází", () => {
  const remote = clientConfig(
    "postgresql://postgres:tajneheslo@db.projekt.supabase.co:5432/postgres",
    { MIGRATE_CA_CERT: "PEM" } as unknown as NodeJS.ProcessEnv,
  );
  const local = clientConfig(
    "postgresql://postgres@localhost:5432/postgres",
    {} as unknown as NodeJS.ProcessEnv,
  );

  it("pozná vzdálenou a lokální databázi", () => {
    expect(isRemoteConfig(remote)).toBe(true);
    expect(isRemoteConfig(local)).toBe(false);
    expect(isRemoteConfig({ host: "/tmp/pg" })).toBe(false);
  });

  it("vzdálená databáze bez --yes se odmítne, s ním projde, lokální projde vždy", () => {
    expect(() => assertSafeTarget(remote, parse([]))).toThrow("--yes");
    expect(() => assertSafeTarget(remote, parse(["--yes"]))).not.toThrow();
    expect(() => assertSafeTarget(local, parse([]))).not.toThrow();
  });

  it("výpis cíle a plánu neobsahuje heslo ani uživatele", () => {
    const text = [describeTarget(remote), ...planLines(parse(["--reset", "--yes"]), remote)].join(
      "\n",
    );
    expect(text).toContain("db.projekt.supabase.co:5432/postgres");
    expect(text).not.toContain("tajneheslo");
    expect(text).not.toContain("postgres:");
    expect(text).toContain("SMAŽE");
    expect(text).toContain("žádné se neodesílají");
  });
});

describe("demo-seed: PIN", () => {
  it("vygenerovaný PIN je šestimístný a platný podle pravidel aplikace", () => {
    for (let i = 0; i < 200; i++) {
      const pin = generatePin();
      expect(pin).toMatch(/^\d{6}$/);
      expect(pinProblem(pin)).toBeNull();
    }
  });

  it("triviální hodnoty přeskočí", () => {
    const values = [0, 123456, 654321, 482915];
    let i = 0;
    expect(generatePin(() => values[i++])).toBe("482915");
  });

  it("PINy se liší při opakování (náhoda)", () => {
    expect(new Set(Array.from({ length: 20 }, () => generatePin())).size).toBeGreaterThan(15);
  });
});

describe("demo-seed: datum svatby", () => {
  const now = new Date("2026-10-12T10:00:00Z");

  it("auto: za rok, v sobotu", () => {
    const date = resolveWeddingDate("auto", now);
    expect(date).toBe("2027-10-16");
    expect(new Date(`${date}T12:00:00Z`).getUTCDay()).toBe(6);
  });

  it("relativní i pevné datum", () => {
    expect(resolveWeddingDate("+2y", now)).toBe("2028-10-14");
    expect(resolveWeddingDate("+18m", now)).toBe("2028-04-15");
    expect(resolveWeddingDate("2030-06-15", now)).toBe("2030-06-15");
  });

  it("odmítne blízké nebo neplatné datum", () => {
    expect(() => resolveWeddingDate("2026-12-01", now)).toThrow(`${MIN_DAYS_AHEAD} dní`);
    expect(() => resolveWeddingDate("2030-02-31", now)).toThrow("Neplatné datum");
    expect(() => resolveWeddingDate("brzy", now)).toThrow("použijte");
  });

  it("výchozí datum vždy splní minimum", () => {
    for (const day of ["2026-01-01", "2026-12-31", "2028-02-29"]) {
      const date = resolveWeddingDate(undefined, new Date(`${day}T12:00:00Z`));
      expect(date >= addDays(day, MIN_DAYS_AHEAD)).toBe(true);
    }
  });
});

describe("demo-seed: identifikátory", () => {
  it("jsou stabilní, platné UUID a závisí na adrese i klíči", () => {
    const id = demoId("test-a-test", "event-ceremony");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(demoId("test-a-test", "event-ceremony")).toBe(id);
    expect(demoId("jina", "event-ceremony")).not.toBe(id);
    expect(demoId("test-a-test", "event-party")).not.toBe(id);
  });
});

describe("demo-seed: obsah webu", () => {
  const startsOn = addDays(todayIn(new Date()), 400);
  const doc = buildDoc({ slug: "test-a-test", startsOn });

  it("používá všechny druhy bloků, zapnuté, s citlivými dary", () => {
    expect(doc.blocks.map((b) => b.type).sort()).toEqual([...blockTypes].sort());
    expect(doc.blocks.every((b) => b.enabled)).toBe(true);
    expect(doc.blocks.find((b) => b.type === "gifts")?.sensitive).toBe(true);
    expect(doc.venues.some((v) => v.isPrivate)).toBe(true);
    const venue = doc.blocks.find((b) => b.type === "venue");
    expect(venue?.type === "venue" && venue.data.showMap).toBe(true);
  });

  it("je kompletně česky i anglicky (žádná mezera v překladu)", () => {
    expect(doc.wedding.locales).toEqual(["cs", "en"]);
    expect(translationGaps(doc)).toEqual([]);
  });

  it("projde kontrolou správy bez chyb a sestaví platný snímek se zadanými médii", () => {
    const issues = validateDoc(doc, { guestPinReady: true });
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    const built = docToPublic(doc, { slug: "test-a-test", quickNotice: QUICK_NOTICE, media: [] });
    expect(built).not.toBeNull();
    expect(() => publicContentSchema.parse(built!.content)).not.toThrow();
    expect(() => sensitiveContentSchema.parse(built!.sensitive)).not.toThrow();
    // citlivé údaje jsou jen v citlivé části
    expect(JSON.stringify(built!.content)).not.toContain("19-2000145399");
    expect(JSON.stringify(built!.content)).not.toContain("Altánová");
    expect(built!.sensitive.gifts?.account).toBe("19-2000145399/0800");
    expect(built!.sensitive.venues[doc.venues.find((v) => v.isPrivate)!.id]?.address).toContain(
      "Altánová",
    );
  });

  it("šablona a paleta existují (výchozí louka / levandule)", () => {
    expect(doc.wedding.template).toBe("louka");
    expect(doc.wedding.palette).toBe("levandule");
  });

  it("je opakovatelný: stejné vstupy dávají stejné identifikátory", () => {
    expect(buildDoc({ slug: "test-a-test", startsOn })).toEqual(doc);
  });

  it("nezmiňuje skutečné kontakty: e-maily jen na vyhrazených doménách", () => {
    const text = JSON.stringify(doc) + JSON.stringify(DEMO_VENDORS) + BACKUP_EMAIL;
    const emails = text.match(/[\w.-]+@[\w.-]+\.\w+/g) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) expect(email).toMatch(/@(example\.com|example\.invalid)$/);
  });
});

describe("demo-seed: hosté, RSVP, dary", () => {
  it("domácnosti mají jedinečné štítky a pokrývají všechny stavy odpovědí", () => {
    const labels = DEMO_HOUSEHOLDS.map((h) => h.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(DEMO_HOUSEHOLDS.some((h) => !h.response)).toBe(true);
    expect(DEMO_HOUSEHOLDS.some((h) => h.response?.plusOne)).toBe(true);
    expect(DEMO_HOUSEHOLDS.some((h) => h.response?.extraChild)).toBe(true);
    expect(DEMO_HOUSEHOLDS.some((h) => h.people.some((p) => p.child))).toBe(true);
    expect(DEMO_HOUSEHOLDS.some((h) => h.people.some((p) => p.diet))).toBe(true);
    const declined = DEMO_HOUSEHOLDS.filter((h) =>
      h.people.every((p) => Object.values(p.attends ?? {}).every((v) => v === false)),
    );
    expect(declined.length).toBeGreaterThan(0);
  });

  it("odpověď nikdy nezmiňuje událost, na kterou domácnost není pozvaná", () => {
    for (const h of DEMO_HOUSEHOLDS) {
      for (const p of h.people) {
        for (const kind of Object.keys(p.attends ?? {})) {
          expect(h.events, `${h.label}: ${kind}`).toContain(kind);
        }
      }
    }
  });

  it("nastavení RSVP: události s potvrzováním, jídelní volba, vše zapnuto, uzávěrka v budoucnu", () => {
    const startsOn = addDays(todayIn(new Date()), 400);
    const settings = buildRsvpSettings("test-a-test", startsOn);
    expect(Object.values(settings.enabled_questions).every(Boolean)).toBe(true);
    expect(settings.questions.find((q) => q.key === "menu")?.options).toHaveLength(3);
    expect(settings.closes_at.slice(0, 10)).toBe(addDays(startsOn, -30));
    expect(settings.allow_unlisted).toBe(true);
  });

  it("dary a dodavatelé mají platné tvary (https, kategorie, stav)", () => {
    for (const g of DEMO_GIFTS) if (g.url) expect(g.url).toMatch(/^https:\/\//);
    for (const v of DEMO_VENDORS) {
      expect(["idea", "contacted", "booked"]).toContain(v.status);
      if (v.url) expect(v.url).toMatch(/^https:\/\//);
    }
    expect(DEMO_GIFTS.some((g) => g.reservedBy !== null)).toBe(true);
  });

  it("zasedací pořádek usadí domácnost pohromadě a nepřekročí kapacitu", () => {
    const base = buildSeatingBase("e".repeat(8));
    const groups = [
      ["g:" + "a".repeat(36), "g:" + "b".repeat(36), "g:" + "c".repeat(36)],
      ["g:" + "d".repeat(36)],
    ];
    const plan = seatHouseholds(base, groups);
    const tables = groups.map((g) => g.map((k) => plan.assignments[k].table));
    expect(new Set(tables[0]).size).toBe(1);
    expect(Object.keys(plan.assignments)).toHaveLength(4);
    expect(base.tables).toHaveLength(6);
  });
});

describe("demo-seed: fotografie", () => {
  it("jsou vlastní (generované), každá má popisek v obou jazycích", () => {
    expect(DEMO_PHOTOS.length).toBeLessThanOrEqual(12);
    for (const photo of DEMO_PHOTOS) {
      expect(photo.alt.cs.length).toBeGreaterThan(5);
      expect(photo.alt.en.length).toBeGreaterThan(5);
      expect(photo.svg).not.toMatch(/<image|href|<script/);
    }
  });

  it("vykreslí se jako platný JPEG", async () => {
    const bytes = await renderPhoto(DEMO_PHOTOS[0]);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    expect(bytes.length).toBeGreaterThan(5_000);
  });
});

describe("demo-seed: volání funkcí databáze", () => {
  type Call = { text: string; values: unknown[] | undefined };
  function fakeClient(result: unknown[] = [{ v: 1 }]) {
    const calls: Call[] = [];
    return {
      calls,
      client: {
        query: async (text: string, values?: unknown[]) => {
          calls.push({ text, values });
          return { rows: /^select (se_vezmou\.[a-z_]+\(|\*)/.test(text) ? result : [] };
        },
      },
    };
  }

  it("před přihlášením jako service_role, v jedné transakci", async () => {
    const { client, calls } = fakeClient();
    await rpc(client as never, "wizard_create_draft", { p_slug: "x", p_work: { a: [1] } });
    expect(calls.map((c) => c.text)).toEqual([
      "begin",
      "set local role service_role",
      "select se_vezmou.wizard_create_draft(p_slug => $1, p_work => $2) as v",
      "commit",
    ]);
    // objekty jdou jako JSON text (pole by `pg` jinak poslalo jako pole PostgreSQL)
    expect(calls[2].values).toEqual(["x", '{"a":[1]}']);
  });

  it("správce: role authenticated, claimy a kontrola aktivní relace", async () => {
    const { client, calls } = fakeClient();
    await rpc(
      client as never,
      "admin_site_load",
      {},
      {
        as: { sub: "s", weddingId: "w", role: "admin" },
      },
    );
    expect(calls[1].text).toBe("set local role authenticated");
    expect(JSON.parse(String(calls[2].values![0]))).toEqual({
      sub: "s",
      wedding_id: "w",
      wedding_role: "admin",
    });
    expect(calls[3].text).toBe("select se_vezmou.assert_admin_session()");
  });

  it("chyba vrátí transakci zpět a hlásí funkci", async () => {
    const calls: string[] = [];
    const client = {
      query: async (text: string) => {
        calls.push(text);
        if (text.includes("boom"))
          throw Object.assign(new Error("invalid_payload"), { code: "22023" });
        return { rows: [] };
      },
    };
    await expect(rpc(client as never, "boom", {})).rejects.toThrow("boom selhala: invalid_payload");
    expect(calls.at(-1)).toBe("rollback");
  });
});
