import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

/**
 * Kryptografické pomůcky přihlášení. Čistý modul bez závislosti na Next.js a bez čtení prostředí:
 * tajné hodnoty dostává jako argument, takže jde testovat samostatně.
 */

export const MIN_SECRET_LENGTH = 32;

export function assertSecret(secret: string, name = "tajná hodnota"): void {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} musí mít aspoň ${MIN_SECRET_LENGTH} znaků`);
  }
}

/** Neprůhledný token relace: 32 náhodných bajtů, v cookie base64url (docs/adr/0002). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Hash tokenu pro databázi: SHA-256 (token má vysokou entropii, pomalý hash není potřeba). */
export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/** Šestimístný kód z kryptograficky bezpečného generátoru (s úvodními nulami). */
export function generateCode(length = 6): string {
  return Array.from({ length }, () => String(randomInt(0, 10))).join("");
}

/** Porovnání v konstantním čase (různá délka = nerovno). */
export function safeEqual(a: Buffer | string, b: Buffer | string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** HMAC-SHA256 s oddělením účelu (`scope`), aby se hodnoty z různých míst nedaly zaměnit. */
export function hmac(secret: string, scope: string, value: string): Buffer {
  assertSecret(secret);
  return createHmac("sha256", secret).update(`${scope}\0${value}`, "utf8").digest();
}

/** Klíč odvozený z tajné hodnoty pro daný účel (HKDF-SHA256). */
function deriveKey(secret: string, purpose: string): Buffer {
  assertSecret(secret);
  return Buffer.from(hkdfSync("sha256", secret, "se-vezmou:auth", `seal:${purpose}`, 32));
}

/**
 * Zapečetí (AES-256-GCM) data do neprůhledného řetězce pro odkaz nebo cookie. Obsah (e-mail, kód)
 * není čitelný v adrese ani v záznamech serveru. Účel je součástí ověřovaných dat, takže token
 * z jednoho místa nejde použít jinde.
 */
export function seal(secret: string, purpose: string, payload: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret, purpose), iv);
  cipher.setAAD(Buffer.from(purpose));
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, data, cipher.getAuthTag()]).toString("base64url");
}

/** Otevře zapečetěná data; neplatný, upravený nebo cizí token vrátí `null`. */
export function unseal<T>(secret: string, purpose: string, token: string): T | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 12 + 16 + 1) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(secret, purpose),
      raw.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    const data = Buffer.concat([
      decipher.update(raw.subarray(12, raw.length - 16)),
      decipher.final(),
    ]);
    return JSON.parse(data.toString("utf8")) as T;
  } catch {
    return null;
  }
}
