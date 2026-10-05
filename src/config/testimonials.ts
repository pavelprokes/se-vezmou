import type { I18nText } from "@/site/i18n-text";

/**
 * Reference párů na úvodní stránce. Sem patří JEN skutečné recenze párů, které web na se-vezmou.cz
 * opravdu použily, s písemným souhlasem (stačí e-mail) se zveřejněním jména, citátu a případně fotky.
 * Žádné vymyšlené ani upravené recenze a žádná strukturovaná data `Review`: zákon o ochraně
 * spotřebitele (novela od 6. 1. 2023) bere falešné recenze jako klamavou praktiku a pod sekcí musí
 * být, jak recenze ověřujeme (`landing.testimonials.verified`).
 *
 * Dokud je seznam prázdný, sekce se na úvodní stránce nevykreslí.
 *
 * Postup přidání:
 * 1. Uložit souhlas páru (e-mail) a datum souhlasu zapsat do `consentOn`.
 * 2. Citát beze změn do jazyka, ve kterém ho pár napsal; překlad do druhého jazyka jen se souhlasem,
 *    jinak druhý jazyk vynechat (stránka ukáže originál s atributem `lang`).
 * 3. Fotku (volitelně, se souhlasem) dát do `public/reference/` a cestu do `photo`.
 */
export interface Testimonial {
  /** Stabilní klíč, např. `klara-a-matej-2027`. */
  id: string;
  /** Jak chce pár být podepsán: jména, nebo jména s iniciálou příjmení. */
  couple: string;
  /** Měsíc svatby `YYYY-MM`. */
  weddingMonth: string;
  quote: I18nText;
  /** Datum písemného souhlasu se zveřejněním `YYYY-MM-DD`. */
  consentOn: string;
  /** Cesta k fotce v `public/` (volitelně). */
  photo?: string;
}

export const testimonials: readonly Testimonial[] = [];
