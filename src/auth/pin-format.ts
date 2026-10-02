import { PIN_LENGTH } from "./config";

/**
 * Tvar PINu (docs/security-privacy.md kap. 1.2): nejméně šest číslic a žádná zjevně triviální
 * hodnota. Čistý modul bez hashování, takže ho smí importovat i prohlížeč (průvodce kontroluje
 * PIN hostů už při psaní). Hashování a ověření jsou v `pin.ts` (jen server).
 */

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
