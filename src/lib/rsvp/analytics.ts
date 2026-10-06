import "server-only";
import type { Locale } from "@/i18n/config";
import { serviceRpc } from "@/lib/db/rpc";
import { trackServerEvent } from "@/lib/umami";

/**
 * Analytika dokončení RSVP (ADR 0007): událost `rsvp_completed` jen s jazykem. Nikdy svatba, jméno,
 * odpověď, e-mail ani IP; databázová funkce `analytics_record` navíc žádný takový argument nemá.
 * Selhání zápisu se jen zaloguje, RSVP na analytice nezávisí.
 */
export async function recordRsvpCompleted(locale: Locale): Promise<void> {
  try {
    await serviceRpc("analytics_record", { p_event: "rsvp_completed", p_locale: locale });
  } catch (error) {
    console.error(
      "[analytika] zápis rsvp_completed selhal",
      error instanceof Error ? error.name : "",
    );
  }
  // Umami: web hosta nesmí vyzradit IP ani prohlížeč hosta (ADR 0007), proto bez požadavku a jen s jazykem.
  await trackServerEvent({
    name: "rsvp-completed",
    url: "/rsvp",
    data: { locale },
    fromRequest: false,
  });
}
