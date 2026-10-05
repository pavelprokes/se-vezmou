import "server-only";
import { loadGuests, type AdminIdentity } from "@/admin/guests/server";
import { weddingTags } from "@/admin/guests/tags";
import { peekSite } from "@/admin/site/server";
import { defaultLocale, intlLocale, type Locale } from "@/i18n/config";
import { cardStyle, type CardStyle } from "./style";
import type { NameCardFormat } from "./layout";
import { nameCardNames, type NameCardAudience } from "./names";

/** Volby jmenovek z adresy (náhled) nebo formuláře (PDF); neznámé hodnoty padají na výchozí. */
export interface NameCardOptions {
  audience: NameCardAudience;
  format: NameCardFormat;
  group: string | null;
  /** Drobný řádek s jmény páru a datem. */
  detail: boolean;
}

/** Parametry v adrese jsou česky: `kdo`, `format`, `skupina`, `radek`. */
export function parseNameCardOptions(get: (key: string) => unknown): NameCardOptions {
  const text = (key: string) => {
    const value = get(key);
    return typeof value === "string" ? value : null;
  };
  const group = text("skupina")?.trim();
  return {
    audience: text("kdo") === "vsichni" ? "all" : "attending",
    format: text("format") === "stojanek" ? "tent" : "flat",
    group: group ? group : null,
    detail: text("radek") !== "0",
  };
}

export interface NameCardData {
  names: string[];
  tags: string[];
  style: CardStyle;
  detail: string | null;
  slug: string | null;
  couple: string;
  /** Výchozí jazyk webu páru: v něm je datum a jazyk PDF (jmenovky čtou hosté). */
  locale: Locale;
}

export async function loadNameCards(
  session: AdminIdentity,
  options: NameCardOptions,
): Promise<NameCardData> {
  const [list, site] = await Promise.all([loadGuests(session), peekSite(session)]);
  const wedding = site?.doc.wedding;
  const couple = wedding
    ? [wedding.partnerA, wedding.partnerB]
        .map((name) => name.trim())
        .filter(Boolean)
        .join(" & ")
    : "";
  const date = wedding?.startsOn
    ? new Intl.DateTimeFormat(intlLocale[wedding.defaultLocale], {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date(`${wedding.startsOn}T12:00:00Z`))
    : null;
  const detail = [couple, date].filter(Boolean).join(" · ");
  const tags = weddingTags(list.households);
  // skupina, která v seznamu není (stará adresa), se ignoruje
  const group = options.group && tags.includes(options.group) ? options.group : null;
  return {
    names: nameCardNames(list, { audience: options.audience, group }),
    tags,
    style: cardStyle(wedding?.template ?? "editorial", wedding?.palette ?? ""),
    detail: options.detail && detail ? detail : null,
    slug: site?.meta.slug ?? null,
    couple,
    locale: wedding?.defaultLocale ?? defaultLocale,
  };
}
