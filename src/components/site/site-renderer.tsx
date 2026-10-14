import type { Locale } from "@/i18n/config";
import type { RsvpSiteState } from "@/lib/rsvp/form";
import type { GiftRegistryView } from "@/site/gifts";
import type { PublicContent, SensitiveContent } from "@/site/types";
import { createSiteCtx, type SiteTranslator } from "./context";
import { siteLayout } from "./models";
import { TEMPLATES } from "./templates";

export interface SiteRendererProps {
  content: PublicContent;
  /** Překlady jmenných prostorů webu v jazyce stránky (`getTranslator(locale, SITE_NAMESPACES)`). */
  t: SiteTranslator;
  /** Adresa téže stránky v jazycích webu (pro přepínač jazyka). */
  localeHrefs?: Partial<Record<Locale, string>>;
  /** Aktuální okamžik pro odpočet; testy ho předávají pevně. */
  now?: Date;
  /** Citlivé bloky (dary) se vykreslí jen s tímto příznakem (FR-PRIV-2). */
  sensitiveUnlocked?: boolean;
  /** Obsah citlivých bloků; bez příznaku `sensitiveUnlocked` se nepoužije. */
  sensitive?: SensitiveContent | null;
  /** Živý stav RSVP (počáteční stav formuláře a volby páru), viz `loadGuestContext`. */
  rsvp?: RsvpSiteState | null;
  /** Seznam věcných darů s rezervací (živá data), viz `loadGuestContext`. */
  registry?: GiftRegistryView | null;
}

/**
 * Vykreslení webu páru: sestaví kontext (`SiteCtx`) a kostru stránky (`siteLayout`) a předá je šabloně
 * podle `content.template` (`./templates`). Šablona rozhoduje o kompozici; data, pravidla zobrazení
 * a citlivé údaje jsou pro všechny šablony stejné.
 */
export function SiteRenderer({
  content,
  t,
  localeHrefs,
  now,
  sensitiveUnlocked = false,
  sensitive = null,
  rsvp = null,
  registry = null,
}: SiteRendererProps) {
  const ctx = createSiteCtx(content, t, { now, sensitiveUnlocked, sensitive, rsvp, registry });
  const Template = TEMPLATES[content.template];
  return <Template ctx={ctx} layout={siteLayout(ctx, localeHrefs)} />;
}
