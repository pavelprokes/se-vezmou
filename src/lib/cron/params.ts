import { z } from "zod";

/**
 * Parametry plánovaných úloh z adresy (`?dry_run=1&batch=50&wedding_id=…&now=…`) a zdroj času.
 *
 * - `dry_run`: úloha spočítá, co by udělala, a nic nezapíše, neodešle ani nesmaže (jen log počtů).
 * - `batch`: strop počtu zpracovaných svateb v jednom kroku (výchozí `DEFAULT_BATCH`).
 * - `wedding_id`: omezí úlohu na jednu svatbu (ruční oprava; v testech nutné se simulovaným časem).
 * - `now`: simulovaný čas. Povolen JEN v testovacím prostředí (`CRON_TEST_CLOCK=1`) a vždy spolu s `wedding_id`,
 *   aby simulace „o dva roky později“ nemohla smazat data jiných svateb. V ostré produkci
 *   (`VERCEL_ENV=production`) je zapnutá testovací hodina chyba nasazení a úloha neběží (jako `EMAIL_TRANSPORT=outbox`).
 */

export const DEFAULT_BATCH = 100;
export const MAX_BATCH = 500;

export class CronParamError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CronParamError";
  }
}

/** Chyba nasazení (ne požadavku): testovací hodina v produkci. */
export class CronConfigError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CronConfigError";
  }
}

export type CronEnvironment = {
  /** `CRON_TEST_CLOCK=1`. */
  testClock: boolean;
  /** `VERCEL_ENV === "production"`. */
  production: boolean;
  /** Skutečný čas (injektovatelný jen kvůli jednotkovým testům samotného parseru). */
  realNow?: () => Date;
};

export type CronParams = {
  dryRun: boolean;
  batch: number;
  weddingId: string | null;
  /** Čas, ke kterému úloha počítá. */
  now: Date;
  /** `true`, když čas nepochází z hodin serveru (jen testy). */
  clockInjected: boolean;
};

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const guid = z.guid();

function flag(value: string | null, name: string): boolean {
  if (value === null) return false;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  throw new CronParamError(`invalid_${name}`);
}

export function parseCronParams(search: URLSearchParams, environment: CronEnvironment): CronParams {
  if (environment.testClock && environment.production) {
    throw new CronConfigError("test_clock_in_production");
  }

  const dryRun = flag(search.get("dry_run"), "dry_run");

  let batch = DEFAULT_BATCH;
  const rawBatch = search.get("batch");
  if (rawBatch !== null) {
    if (!/^\d{1,4}$/.test(rawBatch) || Number(rawBatch) < 1 || Number(rawBatch) > MAX_BATCH) {
      throw new CronParamError("invalid_batch");
    }
    batch = Number(rawBatch);
  }

  const rawWedding = search.get("wedding_id");
  if (rawWedding !== null && !guid.safeParse(rawWedding).success) {
    throw new CronParamError("invalid_wedding_id");
  }
  const weddingId = rawWedding === null ? null : rawWedding.toLowerCase();

  const realNow = environment.realNow ?? (() => new Date());
  const rawNow = search.get("now");
  if (rawNow === null) {
    return { dryRun, batch, weddingId, now: realNow(), clockInjected: false };
  }
  if (!environment.testClock) throw new CronParamError("now_not_allowed");
  if (!weddingId) throw new CronParamError("wedding_id_required_with_now");
  // `+` v adrese se čte jako mezera: posun pásma se píše `%2B` nebo se použije `Z`
  if (!ISO_INSTANT.test(rawNow)) throw new CronParamError("invalid_now");
  const now = new Date(rawNow);
  if (Number.isNaN(now.getTime())) throw new CronParamError("invalid_now");
  return { dryRun, batch, weddingId, now, clockInjected: true };
}
