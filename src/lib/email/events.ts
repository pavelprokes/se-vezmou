/**
 * Události doručení z AWS SES přes SNS (docs/adr/0005-email.md): Delivery, Bounce, Complaint.
 *
 * TODO (M4-5, nasazení): webhook `/api/email/events` na hostiteli `app.` musí
 *  1. ověřit podpis zprávy SNS a potvrdit `SubscriptionConfirmation` jen z očekávaného tématu
 *     (neověřenou zprávu zahodit, omezení počtu požadavků podle zdroje, ADR 0010),
 *  2. převést zprávu na `SesDeliveryEvent` a zavolat `handleSesEvent`,
 *  3. u trvalého odrazu a stížnosti založit adresu do seznamu potlačení.
 * Rozhraní je tu hotové, aby šlo webhook doplnit bez zásahu do odesílání.
 */

export type SesDeliveryEvent =
  | { type: "delivery"; providerMessageId: string }
  | { type: "bounce"; providerMessageId: string; permanent: boolean }
  | { type: "complaint"; providerMessageId: string };

/** Zpracování události: aktualizace `email_log.status` podle `provider_message_id`. */
export interface SesEventHandler {
  handle(event: SesDeliveryEvent): Promise<void>;
}
