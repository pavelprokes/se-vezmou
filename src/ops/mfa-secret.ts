import { seal, unseal } from "@/auth/crypto";

/**
 * Šifrování tajného klíče TOTP pro uložení v databázi (AES-256-GCM přes `seal`, klíč se odvozuje z
 * OPERATOR_MFA_KEY přes HKDF). Účel obsahuje identifikátor operátora, takže šifrový text jednoho
 * operátora nejde přenést k jinému. Čistý modul.
 */

const purpose = (operatorId: string) => `operator-totp:${operatorId}`;

export function encryptTotpSecret(key: string, operatorId: string, secretBase32: string): string {
  return seal(key, purpose(operatorId), { s: secretBase32 });
}

/** Otevře klíč; poškozený, cizí nebo zašifrovaný jiným klíčem je `null`. */
export function decryptTotpSecret(
  key: string,
  operatorId: string,
  encrypted: string,
): string | null {
  const payload = unseal<{ s?: unknown }>(key, purpose(operatorId), encrypted);
  return payload && typeof payload.s === "string" ? payload.s : null;
}
