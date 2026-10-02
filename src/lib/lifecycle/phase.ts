import { dayInZone } from "@/site/format";
import type { WeddingPhase, WeddingStatus } from "@/lib/db/types";

/**
 * Odvozená fáze zveřejněného webu (docs/data-model.md kap. 7). Čistá funkce, která dává totéž co
 * `se_vezmou.phase` v databázi: zlaté vektory `supabase/tests/golden/phase-vectors.tsv` ověřuje
 * SQL test `96_m10_lifecycle` i `phase.test.ts`. Zobrazení fáze nečeká na cron; uložený stav
 * (`published`, `archived`, ...) mění jen akce a úloha životního cyklu.
 *
 * save_the_date -> rsvp_open -> rsvp_closed -> wedding_day -> thanks. Den svatby se počítá
 * v časovém pásmu svatby. Ruční přepsání (`phaseOverride`) platí do zrušení.
 */

export type PhaseInput = {
  status: WeddingStatus;
  /** IANA pásmo svatby. */
  timezone: string;
  /** `YYYY-MM-DD`, nebo `null` (datum zatím není). */
  startsOn: string | null;
  endsOn: string | null;
  /** `null`: svatba nemá nastavení RSVP (fáze zůstává save_the_date). */
  rsvp: { opensAt: Date | null; closesAt: Date | null } | null;
  phaseOverride: WeddingPhase | null;
};

export function derivePhase(wedding: PhaseInput, at: Date): WeddingPhase | null {
  if (wedding.status !== "published") return null;
  if (wedding.phaseOverride) return wedding.phaseOverride;
  if (!wedding.startsOn) return "save_the_date";

  const first = wedding.startsOn;
  const last = wedding.endsOn ?? wedding.startsOn;
  // ISO řetězce `YYYY-MM-DD` se řadí abecedně stejně jako kalendářně.
  const today = dayInZone(at, wedding.timezone);
  if (today > last) return "thanks";
  if (today >= first) return "wedding_day";

  if (!wedding.rsvp) return "save_the_date";
  const { opensAt, closesAt } = wedding.rsvp;
  if (closesAt && at.getTime() >= closesAt.getTime()) return "rsvp_closed";
  // opensAt null = bez omezení: RSVP je otevřené hned po zveřejnění
  if (!opensAt || at.getTime() >= opensAt.getTime()) return "rsvp_open";
  return "save_the_date";
}
