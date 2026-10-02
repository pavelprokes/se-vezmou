/**
 * Strukturovaný log plánovaných úloh: jedna řádka JSON na událost, BEZ osobních údajů.
 * Smí nést jen názvy úloh, stavy, počty a kódy chyb. Pojistka: řetězcová hodnota, která vypadá jako
 * e-mailová adresa (obsahuje `@`), se nahradí; hodnoty jiných typů než číslo, logická hodnota a krátký
 * řetězec se zahodí. Chyby se logují jen názvem a kódem (zpráva může nést údaje z dotazu).
 */

export type LogLevel = "info" | "warn" | "error";
export type LogValue = string | number | boolean | null;
export type LogFields = Record<string, LogValue | undefined>;

const SAFE_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_STRING = 80;

export function sanitizeLogFields(fields: LogFields): Record<string, LogValue> {
  const out: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || !SAFE_KEY.test(key)) continue;
    if (typeof value === "string") {
      out[key] = value.includes("@") ? "[redacted]" : value.slice(0, MAX_STRING);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      out[key] = value;
    }
  }
  return out;
}

export function formatLog(level: LogLevel, event: string, fields: LogFields = {}): string {
  return JSON.stringify({ level, event, ...sanitizeLogFields(fields) });
}

export function cronLog(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line = formatLog(level, event, fields);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

/** Bezpečný popis chyby do logu a do auditu: název a kód, nikdy zpráva ani argumenty volání. */
export function errorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    const name = (error as { name?: unknown }).name;
    const fn = (error as { fn?: unknown }).fn;
    const parts = [
      typeof name === "string" ? name : "Error",
      typeof fn === "string" ? fn : undefined,
      typeof code === "string" ? code : undefined,
    ].filter(Boolean);
    return parts.join(":").slice(0, 100);
  }
  return "UnknownError";
}
