import { BLOCKED_SLUG_WORDS, EXTRA_RESERVED_SLUGS, RESERVED_SLUGS } from "@/config/reserved-slugs";
import type { Locale } from "@/i18n/config";

/**
 * Adresa webu páru (`<slug>.se-vezmou.cz`), FR-WZ-4, docs/data-model.md kap. 6. Čistý modul bez
 * závislosti na serveru: používá ho prohlížeč (náhled adresy při psaní jmen) i server (kontrola
 * před zápisem). Autoritativní kontrolu dostupnosti dělá databáze (`check_slug`, `reserve_slug`).
 */

export const SLUG_MIN = 3;
export const SLUG_MAX = 63;

/** Písmena, která se po odstranění diakritiky nezmění sama (NFD je nerozloží). */
const SPECIAL: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  ł: "l",
  đ: "d",
  ð: "d",
  þ: "th",
  ı: "i",
};

/** Diakritika -> ASCII, malá písmena (`Klára` -> `klara`). */
export function asciiFold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (char) => SPECIAL[char] ?? char);
}

/** Jedna část adresy: jen `a-z0-9` a jednotlivé pomlčky, bez pomlček na kraji. */
export function slugPart(text: string): string {
  return asciiFold(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const JOINER: Record<Locale, string> = { cs: "a", en: "and" };

/** Zkrátí na `max` znaků na hranici pomlčky, je-li to rozumné; bez pomlčky na konci. */
function shorten(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const boundary = cut.lastIndexOf("-");
  const result = boundary >= Math.ceil(max / 2) ? cut.slice(0, boundary) : cut;
  return result.replace(/-+$/g, "");
}

/**
 * Návrh adresy z jmen páru: `Klára`, `Matěj` -> `klara-a-matej` (anglicky `klara-and-matej`).
 * Dlouhá jména se krátí tak, aby celek nepřesáhl 63 znaků. Bez jmen vrací prázdný řetězec.
 */
export function slugFromNames(first: string, second: string, locale: Locale = "cs"): string {
  const a = slugPart(first);
  const b = slugPart(second);
  if (!a && !b) return "";
  if (!a || !b) return shorten(a || b, SLUG_MAX);

  const joiner = `-${JOINER[locale]}-`;
  const joined = `${a}${joiner}${b}`;
  if (joined.length <= SLUG_MAX) return joined;

  // Každé jméno dostane stejný díl zbytku, delší jméno se krátí víc.
  const room = SLUG_MAX - joiner.length;
  const half = Math.floor(room / 2);
  const shortA = a.length <= half ? a : shorten(a, room - Math.min(b.length, half));
  const shortB = shorten(b, room - shortA.length);
  return `${shortA}${joiner}${shortB}`.slice(0, SLUG_MAX).replace(/-+$/g, "");
}

/**
 * Vstup z pole adresy: odstraní schéma a doménu (`klara-a-matej.se-vezmou.cz` i s `https://`),
 * diakritiku a nepovolené znaky. Při psaní (`final: false`) ponechá pomlčku na konci, aby šlo psát
 * `klara-a-`; při dokončení ji odstraní.
 */
export function normalizeSlugInput(raw: string, options: { final?: boolean } = {}): string {
  const final = options.final ?? true;
  const label = raw
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .split(/[/:]/)[0]
    .replace(/\.(se-vezmou\.(cz|localhost)|localhost)$/i, "");
  const folded = asciiFold(label)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "");
  const limited = folded.slice(0, SLUG_MAX);
  return final ? limited.replace(/-+$/g, "") : limited;
}

export type SlugProblem = "empty" | "too_short" | "too_long" | "format" | "reserved";

/**
 * Pravidla adresy: 3 až 63 znaků `a-z0-9` a pomlčky, bez pomlčky na kraji a bez dvou za sebou,
 * ne rezervované slovo ani blokovaný výraz. `null` = v pořádku (dostupnost to neříká).
 */
export function slugProblem(slug: string): SlugProblem | null {
  if (slug === "") return "empty";
  if (slug.length > SLUG_MAX) return "too_long";
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug) || slug.includes("--")) return "format";
  if (slug.length < SLUG_MIN) return "too_short";
  return isReservedSlug(slug) ? "reserved" : null;
}

const RESERVED_EXACT = new Set<string>([...RESERVED_SLUGS, ...EXTRA_RESERVED_SLUGS]);
const BLOCKED = new Set<string>(BLOCKED_SLUG_WORDS);

/** Rezervované slovo, nebo blokovaný výraz jako celé slovo (stejné pravidlo jako v databázi). */
export function isReservedSlug(slug: string): boolean {
  if (RESERVED_EXACT.has(slug) || BLOCKED.has(slug)) return true;
  return slug
    .split("-")
    .some((token) => token.length >= 4 && (BLOCKED.has(token) || RESERVED_EXACT.has(token)));
}

/** Adresa končí rokem nebo rokem a měsícem (`-2027`, `-2027-06`): prozradí rok svatby. */
export function slugRevealsYear(slug: string): boolean {
  return /(^|-)(19|20)\d{2}(-(0[1-9]|1[0-2]))?$/.test(slug);
}

export type VariantKind = "year" | "month" | "random";

/**
 * Druh varianty nabídnuté při kolizi (`klara-a-matej-2027`, `-2027-06`, `-k7m2`) podle
 * její koncovky; `null`, pokud na variantu nevypadá.
 */
export function variantKind(variant: string): VariantKind | null {
  if (/-(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(variant)) return "month";
  if (/-(19|20)\d{2}$/.test(variant)) return "year";
  if (/-[a-z0-9]{4}$/.test(variant)) return "random";
  return null;
}

/** Obsazená adresa, ke které databáze varianty nabídla (bez koncovky roku, měsíce nebo náhodných znaků). */
export function variantBase(variant: string): string {
  return variant.replace(/-((19|20)\d{2}(-(0[1-9]|1[0-2]))?|[a-z0-9]{4})$/, "");
}

/** Datum svatby jako doplněk adresy: `2027-06-19` -> `19-6-2027`. */
export function dateSuffix(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return year && month && day ? `${day}-${month}-${year}` : "";
}
