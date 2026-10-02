import { z } from "zod";
import { LOGIN_CODE } from "./config";
import { hmac } from "./crypto";

/** Normalizace a hashování e-mailů, kódů a adres pro databázi. Čistý modul (tajná hodnota je argument). */

const emailSchema = z.email().max(254);

/** Sjednocený tvar e-mailu (bez mezer, malá písmena), nebo `null`, když to není e-mail. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.normalize("NFC").trim().toLowerCase();
  return emailSchema.safeParse(email).success ? email : null;
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

/** HMAC e-mailu pro `login_challenges.email_hash`: v databázi není čitelný e-mail. */
export function emailHash(secret: string, email: string): Buffer {
  return hmac(secret, "login:email", email);
}

/** HMAC kódu svázaný s e-mailem: z uniklé databáze nejde miliony kódů zkoušet bez tajné hodnoty. */
export function codeHash(secret: string, email: string, code: string): Buffer {
  return hmac(secret, "login:code", `${email}\0${code}`);
}

/**
 * Kód z formuláře: číslice, případně s mezerami nebo spojovníky (vložení "123 456" ze schránky
 * nebo z opsané zprávy). Jiný tvar je `null`.
 */
export function parseCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/[\s-]/g, "");
  return new RegExp(`^[0-9]{${LOGIN_CODE.length}}$`).test(digits) ? digits : null;
}

/**
 * Slug z formuláře: malá písmena, bez schématu a bez domény ("klara-a-matej.se-vezmou.cz" i
 * "https://klara-a-matej.se-vezmou.cz/" dá "klara-a-matej"). Neplatný tvar je `null`.
 */
export function parseSlug(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const label = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[/.:]/)[0];
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label) && !label.includes("--") ? label : null;
}
