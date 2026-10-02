/**
 * Sjednocení vstupů z formulářů průvodce. Čisté funkce: stejné používá kontrola při psaní
 * v prohlížeči i server při uložení.
 */

/**
 * Odkaz na ubytování: bez schématu se doplní `https://` (`www.penzion.cz`). Jen http(s), jiné
 * schéma (`javascript:`) nebo nesmysl je `null`.
 */
export function normalizeUrl(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;
  const withScheme =
    /^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z0-9.-]+:\d+/i.test(value)
      ? value
      : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Telefon: číslice, mezery a případné `+` na začátku (`+420 777 123 456`). Spojovníky, tečky
 * a závorky se převedou na mezeru. Tvar, který web nepřijme (6 až 20 znaků), je `null`.
 */
export function normalizePhone(raw: string): string | null {
  const value = raw
    .trim()
    .replace(/[-.()/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^\+?[0-9 ]{6,20}$/.test(value) && /[0-9]{6}/.test(value.replace(/ /g, "")) ? value : null;
}
