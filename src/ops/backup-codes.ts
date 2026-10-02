import { randomInt } from "node:crypto";
import { hmac } from "@/auth/crypto";

/**
 * Záložní kódy druhého faktoru (ADR 0012). Deset kódů po deseti znacích z abecedy bez zaměnitelných
 * znaků (bez 0, 1, I a O), zobrazí se jednou jako `ABCDE-FGHJK`. V databázi je jen HMAC svázaný s operátorem
 * (klíč OPERATOR_MFA_KEY), takže z uniklé tabulky nejdou kódy zpětně odvodit ani přenést k jinému operátorovi.
 * Čistý modul: tajnou hodnotu dostává jako argument.
 */

export const BACKUP_CODE_COUNT = 10;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LENGTH = 10;

function randomCode(): string {
  return Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

export function formatBackupCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** Nová sada (každý kód je jiný), ve tvaru pro zobrazení. */
export function generateBackupCodes(count: number = BACKUP_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(randomCode());
  return [...codes].map(formatBackupCode);
}

/**
 * Kód z formuláře: malá i velká písmena, mezery a spojovníky se odpustí. Jiný tvar (včetně znaků,
 * které abeceda nemá) je `null`.
 */
export function normalizeBackupCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const clean = input.replace(/[\s-]/g, "").toUpperCase();
  return new RegExp(`^[${ALPHABET}]{${LENGTH}}$`).test(clean) ? clean : null;
}

/** HMAC kódu pro `operator_backup_codes.code_hash`; vstup je normalizovaný kód (bez spojovníku). */
export function hashBackupCode(key: string, operatorId: string, normalizedCode: string): Buffer {
  return hmac(key, "operator:backup-code", `${operatorId}\0${normalizedCode}`);
}
