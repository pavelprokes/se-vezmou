/**
 * Cena na jednom místě (FR-LP-3).
 * Čerpá z nich viditelný text, karty ceny i strukturovaná data `SoftwareApplication`,
 * takže se číslo na stránce a ve značkách nikdy nerozejde.
 *
 * Nikdy neslibujeme „zdarma navždy“ a veřejně nemluvíme o „zaváděcím provozu“: cena je „teď 0 Kč“
 * a její případnou změnu provozovatel oznámí předem (OQ-11).
 */

export const CURRENCY = "CZK";

/** Jedna karta ceny (OQ-30); koncept a zveřejnění se rozdělí, až bude zveřejnění placené (docs/todo.md). */
export const PLAN_IDS = ["published"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface Plan {
  id: PlanId;
  /** Cena v celých korunách; 0 Kč teď. */
  price: number;
  /** Karta, která je ve vzhledu zvýrazněná (zveřejněný web). */
  highlighted: boolean;
}

export interface Pricing {
  currency: string;
  plans: readonly Plan[];
  introEndsOn: string | null;
}

export const pricing: Pricing = {
  currency: CURRENCY,
  plans: [{ id: "published", price: 0, highlighted: true }],
  /**
   * Konec zaváděcího provozu (ISO datum). `null` = zatím neurčen, proto se `priceValidUntil`
   * ve strukturovaných datech nevypisuje (technical-design 6.3).
   */
  introEndsOn: null,
};

/** Nejnižší cena napříč kartami (pro `SoftwareApplication.offers`). */
export function lowestPrice(config: Pricing = pricing): number {
  return Math.min(...config.plans.map((plan) => plan.price));
}
