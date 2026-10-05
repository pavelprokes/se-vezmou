import { z } from "zod";
import { WEDDING_STATUSES, type WeddingStatus } from "@/lib/db/types";
import { templateKeys } from "@/site/themes/palettes";
import { PAGE_SIZE } from "./config";
import { defaultLocale, localePath, locales, type Locale } from "@/i18n/config";

/**
 * Filtry seznamu zakázek z adresy (`?stav=published&jazyk=cs&sablona=modern&mesic=2027-06&q=klara&strana=2`).
 * Čistý modul: neplatná hodnota se tiše zahodí (nikdy nevyvolá chybu stránky), takže ručně upravená adresa
 * nikdy nic nerozbije ani nevyvolá dotaz s nečekanou hodnotou.
 */

export const TEMPLATES = templateKeys;
/** Jazyky webu ve filtru: všechny jazyky aplikace (`src/i18n/config.ts`). */
export const LOCALES = locales;

export type ListQuery = {
  status?: WeddingStatus;
  locale?: Locale;
  template?: (typeof TEMPLATES)[number];
  /** `RRRR-MM` z formuláře. */
  month?: string;
  query?: string;
  page: number;
};

type Raw = Record<string, string | string[] | undefined>;

function first(raw: Raw, key: string): string | undefined {
  const value = raw[key];
  return Array.isArray(value) ? value[0] : value;
}

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export function parseListQuery(raw: Raw): ListQuery {
  const status = z.enum(WEDDING_STATUSES).safeParse(first(raw, "stav"));
  const locale = z.enum(LOCALES).safeParse(first(raw, "jazyk"));
  const template = z.enum(TEMPLATES).safeParse(first(raw, "sablona"));
  const month = monthSchema.safeParse(first(raw, "mesic"));
  const query = first(raw, "q")?.trim().slice(0, 100);
  const page = Number(first(raw, "strana"));
  return {
    ...(status.success ? { status: status.data } : {}),
    ...(locale.success ? { locale: locale.data } : {}),
    ...(template.success ? { template: template.data } : {}),
    ...(month.success ? { month: month.data } : {}),
    ...(query ? { query } : {}),
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** Parametry dotazu na databázi (měsíc jako první den měsíce, stránka jako posun). */
export function toFilters(query: ListQuery) {
  return {
    status: query.status,
    locale: query.locale,
    template: query.template,
    month: query.month ? `${query.month}-01` : undefined,
    query: query.query,
    limit: PAGE_SIZE,
    offset: (query.page - 1) * PAGE_SIZE,
  };
}

/** Adresa seznamu se zadanými filtry (bez prázdných hodnot); `page` 1 se neuvádí. */
export function listHref(
  query: ListQuery,
  page: number = query.page,
  locale: Locale = defaultLocale,
): string {
  const params = new URLSearchParams();
  if (query.status) params.set("stav", query.status);
  if (query.locale) params.set("jazyk", query.locale);
  if (query.template) params.set("sablona", query.template);
  if (query.month) params.set("mesic", query.month);
  if (query.query) params.set("q", query.query);
  if (page > 1) params.set("strana", String(page));
  const search = params.toString();
  return localePath(search ? `/zakazky?${search}` : "/zakazky", locale);
}
