/**
 * QR platba podle formátu SPAYD (český standard): bez pevné částky, jen účet a zpráva.
 * Čisté funkce bez závislostí; QR obrázek skládá komponenta z modulů vygenerovaných lokálně.
 */

/** IBAN podle ISO 13616 (kontrolní součet mod 97). */
export function isValidIban(value: string): boolean {
  const iban = value.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** Zpráva do SPAYD: velká písmena bez diakritiky, bez `*`, nejvýše 60 znaků. */
export function spaydMessage(message: string): string {
  return message
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 .,\-/:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** `SPD*1.0*ACC:CZ...*CC:CZK*MSG:...`; bez položky `AM`, takže částku zvolí dárce. */
export function buildSpayd({ iban, message }: { iban: string; message?: string | null }): string {
  const parts = ["SPD", "1.0", `ACC:${iban.replace(/\s+/g, "").toUpperCase()}`, "CC:CZK"];
  const msg = message ? spaydMessage(message) : "";
  if (msg) parts.push(`MSG:${msg}`);
  return parts.join("*");
}
