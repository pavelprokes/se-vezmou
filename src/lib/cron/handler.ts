import { isAuthorizedCron } from "./authorize";
import { cronLog } from "./log";
import { CronConfigError, CronParamError, parseCronParams, type CronEnvironment } from "./params";
import { runJob, type JobDefinition, type JobReport, type JobRunStore } from "./run";

/**
 * Společný obsluhovač cest `/api/cron/*` (Vercel Cron volá metodou GET s hlavičkou
 * `Authorization: Bearer ${CRON_SECRET}`; POST je totéž pro ruční spuštění). Pořadí kontrol:
 *  1. autorizace (jinak 401 bez dalších údajů; úloha se nespustí a nic se nezapíše),
 *  2. nasazení (testovací hodina v produkci = chyba 500, nikdy se nespustí),
 *  3. parametry (`dry_run`, `batch`, `wedding_id`, `now` jen v testech), jinak 400,
 *  4. běh úloh za sebou ve sdíleném časovém rozpočtu; 500, když některá úloha selhala (Vercel i monitoring
 *     to uvidí), jinak 200 s přehledem počtů (nikdy s osobními údaji).
 * Proxy cesty `/api/cron/*` z matcheru vynechává (src/proxy.ts), takže na hostiteli nezáleží; proto je
 * autorizace tady, ne v proxy.
 */

/** Časový rozpočet jednoho požadavku; `maxDuration` cest je 60 s. */
export const BUDGET_MS = 50_000;

export type CronHandlerOptions = {
  jobs: readonly JobDefinition[];
  /** Povolit parametr `now` (jen v testovacím prostředí): ne u úklidu, který je globální. */
  allowTestClock: boolean;
};

export type CronHandlerDeps = {
  environment: () => CronEnvironment & { secret: string | undefined };
  store: () => JobRunStore;
  reportFailure: (job: string, code: string) => void;
  budgetMs: number;
};

const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Type": "application/json; charset=utf-8",
};

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });

export function createCronHandler(
  options: CronHandlerOptions,
  deps: CronHandlerDeps,
): (request: Request) => Promise<Response> {
  return async function handle(request) {
    const environment = deps.environment();
    if (!isAuthorizedCron(request.headers.get("authorization"), environment.secret)) {
      cronLog("warn", "cron_unauthorized", {
        reason: environment.secret ? "bad_header" : "no_secret",
      });
      return json(401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
    }

    let params;
    try {
      params = parseCronParams(new URL(request.url).searchParams, environment);
      if (params.clockInjected && !options.allowTestClock) {
        throw new CronParamError("now_not_supported");
      }
    } catch (error) {
      if (error instanceof CronConfigError) {
        cronLog("error", "cron_misconfigured", { error_code: error.code });
        return json(500, { error: error.code });
      }
      if (error instanceof CronParamError) return json(400, { error: error.code });
      throw error;
    }

    const deadline = Date.now() + deps.budgetMs;
    const store = deps.store();
    const reports: JobReport[] = [];
    for (const job of options.jobs) {
      const report = await runJob(
        job,
        {
          now: params.now,
          dryRun: params.dryRun,
          batch: params.batch,
          weddingId: params.weddingId,
          timeLeftMs: () => deadline - Date.now(),
        },
        store,
      );
      if (report.status === "failed") deps.reportFailure(job.name, report.errorCode ?? "unknown");
      reports.push(report);
    }

    const failed = reports.some((r) => r.status === "failed");
    return json(failed ? 500 : 200, {
      dry_run: params.dryRun,
      jobs: reports.map((r) => ({
        job: r.job,
        status: r.status,
        counts: r.counts,
        error_code: r.errorCode ?? null,
        duration_ms: r.durationMs,
      })),
    });
  };
}
