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

/** BIC/SWIFT podle ISO 9362: 8 nebo 11 znaků (banka, země, místo, volitelně pobočka). */
export function isValidBic(value: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalizeBic(value));
}

export function normalizeBic(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
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

/** Text do EPC QR: jeden řádek (bez konců řádků), ořez a strop délky ve znacích (emoji se nerozdělí). */
function epcLine(value: string, max: number): string {
  return Array.from(
    value
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, max)
    .join("")
    .trim();
}

/** Norma dovoluje nejvýš 331 bajtů obsahu (UTF-8). */
const EPC_MAX_BYTES = 331;
const utf8Length = (text: string) => new TextEncoder().encode(text).length;

/**
 * EPC QR („GiroCode“, EPC069-12 verze 002) pro převod SEPA v eurech ze zahraničí: BIC (nepovinný), jméno
 * příjemce (povinné, nejvýš 70 znaků), IBAN, bez částky (zvolí dárce) a zpráva (nejvýš 140 znaků).
 * Kódování UTF-8. Bez jména příjemce formát QR nedovoluje: `null`.
 */
export function buildEpcQr({
  iban,
  bic,
  name,
  message,
}: {
  iban: string;
  bic?: string | null;
  name: string | null | undefined;
  message?: string | null;
}): string | null {
  const recipient = epcLine(name ?? "", 70);
  if (recipient === "") return null;
  const lines = [
    "BCD",
    "002",
    "1",
    "SCT",
    bic ? normalizeBic(bic) : "",
    recipient,
    iban.replace(/\s+/g, "").toUpperCase(),
    "",
    "",
    "",
    epcLine(message ?? "", 140),
  ];
  // dlouhá diakritika může přesáhnout 331 bajtů: zkrátit nejdřív zprávu, pak jméno
  for (const index of [10, 5]) {
    while (utf8Length(lines.join("\n")) > EPC_MAX_BYTES && lines[index] !== "") {
      lines[index] = Array.from(lines[index]).slice(0, -1).join("").trim();
    }
  }
  // prázdné řádky na konci se podle normy vynechávají
  while (lines.at(-1) === "") lines.pop();
  return lines.join("\n");
}
