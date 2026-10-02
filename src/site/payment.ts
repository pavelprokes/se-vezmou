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

const CZ_WEIGHTS = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1] as const;

/** Kontrolní součet části tuzemského čísla účtu (předčíslí nebo číslo): vážený součet dělitelný 11. */
function czPartValid(part: string): boolean {
  if (!/^\d{1,10}$/.test(part)) return false;
  const digits = part.padStart(10, "0");
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(digits[i]) * CZ_WEIGHTS[i];
  return sum % 11 === 0;
}

/** `[předčíslí-]číslo/kód banky` s kontrolou součtů (předčíslí i číslo); `null` při neplatném tvaru. */
export function parseCzAccount(
  value: string,
): { prefix: string; number: string; bank: string } | null {
  const match = /^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/.exec(value.replace(/\s+/g, ""));
  if (!match) return null;
  const [, prefix = "", number, bank] = match;
  if ((prefix !== "" && !czPartValid(prefix)) || !czPartValid(number)) return null;
  return { prefix, number, bank };
}

export function isValidCzAccount(value: string): boolean {
  return parseCzAccount(value) !== null;
}

/** IBAN českého účtu (CZkk BBBB PPPP PPAA AAAA AAAA); kontrolní číslice podle ISO 13616. */
export function czAccountToIban(value: string): string | null {
  const parsed = parseCzAccount(value);
  if (!parsed) return null;
  const bban = `${parsed.bank}${parsed.prefix.padStart(6, "0")}${parsed.number.padStart(10, "0")}`;
  let remainder = 0;
  for (const digit of `${bban}123500`) remainder = (remainder * 10 + Number(digit)) % 97;
  return `CZ${String(98 - remainder).padStart(2, "0")}${bban}`;
}
