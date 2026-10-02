export { normalizePhone, normalizeUrl } from "@/wizard/normalize";

/**
 * Odkaz na externí galerii: jen `https`. Bez schématu se doplní `https://`; `http:`, `javascript:`,
 * `data:` i jiná schémata, adresa s přihlašovacími údaji a hostitel bez tečky (`localhost`) se
 * odmítnou (`null`). Výsledek je normalizovaná adresa (nejvýše 500 znaků).
 */
export function normalizeHttpsUrl(raw: string): string | null {
  const value = raw.trim();
  if (value === "" || /\s/.test(value)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z0-9.-]+:\d+(\/|$)/i.test(value);
  if (hasScheme && !/^https:\/\//i.test(value)) return null;
  try {
    const url = new URL(hasScheme ? value : `https://${value}`);
    if (url.protocol !== "https:") return null;
    if (url.username !== "" || url.password !== "") return null;
    if (!url.hostname.includes(".") || url.hostname.endsWith(".")) return null;
    const result = url.toString();
    return result.length <= 500 ? result : null;
  } catch {
    return null;
  }
}
