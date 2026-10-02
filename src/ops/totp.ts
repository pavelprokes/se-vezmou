import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP podle RFC 6238 (HMAC-SHA1, 6 číslic, krok 30 sekund) a HOTP podle RFC 4226. Vlastní krátká
 * implementace nad `node:crypto` (ADR 0012): žádná závislost, žádné I/O, čistý modul. Aplikace TOTP
 * (Google Authenticator, Aegis, správci hesel) počítají totéž, takže se volba SHA-1 nedá změnit,
 * aniž by se přestaly shodovat.
 */

export const TOTP = {
  digits: 6,
  periodSeconds: 30,
  /** Kolik kroků na obě strany se toleruje (nepřesné hodiny telefonu): ±30 sekund. */
  window: 1,
  /** 160 bitů, jak doporučuje RFC 4226. */
  secretBytes: 20,
} as const;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Base32 (RFC 4648) bez doplňku `=`, velkými písmeny; tak ho čekají aplikace TOTP. */
export function base32Encode(data: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Odpustí malá písmena, mezery, spojovníky a `=`; cokoli jiného (nebo prázdný vstup) je `null`. */
export function base32Decode(text: string): Buffer | null {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  if (clean === "") return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) return null;
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Nový tajný klíč jako base32 (32 znaků). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP.secretBytes));
}

/** HOTP (RFC 4226) pro daný čítač. */
export function hotp(secret: Uint8Array, counter: number, digits: number = TOTP.digits): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Číslo časového kroku pro okamžik v milisekundách (Unix čas / 30 s). */
export function timeStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP.periodSeconds);
}

/** Kód TOTP pro okamžik (jen pro testy a vývoj; server kódy nikdy nevydává). */
export function totpAt(secretBase32: string, nowMs: number): string {
  const secret = base32Decode(secretBase32);
  if (!secret) throw new Error("Neplatný tajný klíč TOTP");
  return hotp(secret, timeStep(nowMs));
}

function sameCode(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Ověří kód a vrátí jeho časový krok, nebo `null`. Přijímá se jen krok NOVĚJŠÍ než `lastStep`
 * (poslední už použitý): každý kód jde použít jednou, i kdyby ho někdo odposlechl během 30 sekund.
 * Všechny kroky okna se porovnávají vždy (bez předčasného konce), aby doba nevyzrazovala shodu.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs: number,
  lastStep: number | null,
): number | null {
  const secret = base32Decode(secretBase32);
  if (!secret || !new RegExp(`^[0-9]{${TOTP.digits}}$`).test(code)) return null;
  const current = timeStep(nowMs);
  let matched: number | null = null;
  for (let step = current - TOTP.window; step <= current + TOTP.window; step++) {
    if (step < 0) continue;
    if (sameCode(hotp(secret, step), code) && (lastStep === null || step > lastStep)) {
      matched = matched === null ? step : Math.max(matched, step);
    }
  }
  return matched;
}

/** Kód z formuláře: číslice, případně s mezerou nebo spojovníkem uprostřed ("123 456"); jinak `null`. */
export function parseTotpCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/[\s-]/g, "");
  return new RegExp(`^[0-9]{${TOTP.digits}}$`).test(digits) ? digits : null;
}

/** Adresa `otpauth://` pro QR kód a odkaz „otevřít v aplikaci“ (Key URI Format). */
export function otpauthUri(input: { issuer: string; account: string; secret: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const query = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(TOTP.digits),
    period: String(TOTP.periodSeconds),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

/** Klíč po čtyřech znacích (`ABCD EFGH ...`), aby šel snáz opsat; vkládá se i s mezerami. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ");
}
