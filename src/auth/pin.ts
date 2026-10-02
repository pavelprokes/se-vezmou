import { hash, verify, type Algorithm } from "@node-rs/argon2";
import { PIN_LENGTH } from "./config";
import { hmac } from "./crypto";

/**
 * PIN správy a PIN hostů (docs/security-privacy.md kap. 1.2): nejméně šest číslic, hash argon2id
 * s pepperem (PIN se nejdřív zpracuje HMAC tajnou hodnotou mimo databázi). Čistý modul: pepper
 * dostává jako argument.
 *
 * Upřímné omezení: šestimístný PIN má milion hodnot; skutečnou ochranou je omezení pokusů a pepper.
 */

/** Argon2id podle doporučení OWASP (m = 19 MiB, t = 2, p = 1); ověřit měřením na Vercelu. */
const ARGON2 = {
  algorithm: 2 as Algorithm, // Argon2id (const enum nejde importovat při isolatedModules)
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export type PinProblem = "format" | "trivial";

const PIN_PATTERN = new RegExp(`^[0-9]{${PIN_LENGTH.min},${PIN_LENGTH.max}}$`);

function isTrivial(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true; // 000000, 111111 ...
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]);
  // postupka nahoru nebo dolů (123456, 654321)
  return steps.every((s) => s === 1) || steps.every((s) => s === -1);
}

/** Zkontroluje tvar a zakáže zjevně triviální hodnoty. `null` = v pořádku. */
export function pinProblem(pin: string): PinProblem | null {
  if (!PIN_PATTERN.test(pin)) return "format";
  return isTrivial(pin) ? "trivial" : null;
}

/** Vstup z formuláře: odstraní mezery a spojovníky (opsání z papíru), nic dalšího. */
export function normalizePinInput(input: string): string {
  return input.replace(/[\s-]/g, "");
}

function peppered(pin: string, pepper: string): string {
  return hmac(pepper, "pin", pin).toString("base64");
}

export async function hashPin(pin: string, pepper: string): Promise<string> {
  return hash(peppered(pin, pepper), ARGON2);
}

/** Ověření; jakákoli chyba (poškozený hash) je neshoda, nikdy výjimka směrem k uživateli. */
export async function verifyPin(storedHash: string, pin: string, pepper: string): Promise<boolean> {
  try {
    return await verify(storedHash, peppered(pin, pepper));
  } catch {
    return false;
  }
}

/**
 * Hash neexistujícího PINu pro vyrovnání času: neznámá svatba i svatba bez PINu stojí stejný
 * výpočet jako chybný PIN (odpověď nesmí prozradit existenci).
 */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(pepper: string): Promise<string> {
  dummyHash ??= hashPin("0a1b2c3d4e5f", pepper);
  return dummyHash;
}
