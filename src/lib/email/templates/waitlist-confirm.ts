import type { Locale } from "@/i18n/config";
import { composeEmail, type Block, type RenderedEmail } from "./shared";

/**
 * Potvrzení zápisu na oznámení o spuštění (čekací listina, double opt-in): odkaz vede na stránku s tlačítkem, adresa se zapíše až po
 * jeho stisknutí (skener pošty, který odkaz otevře, nic nepotvrdí). Odkaz platí 7 dní.
 */

export type WaitlistConfirmParams = {
  locale: Locale;
  link: string;
};

const COPY = {
  cs: {
    brand: "Se vezmou",
    subject: "Potvrďte zápis na oznámení o spuštění",
    heading: "Potvrďte svůj e-mail",
    intro:
      "Děkujeme za zájem o Se vezmou. Abychom vám mohli poslat oznámení o spuštění, potvrďte prosím, že tato adresa patří vám.",
    linkText: "Potvrdit zápis",
    validity: "Odkaz platí 7 dní. Bez potvrzení vaši adresu po této době smažeme.",
    ignore:
      "Pokud jste se na oznámení o spuštění nezapisovali, tuto zprávu ignorujte. Nic dalšího vám neposíláme.",
  },
  en: {
    brand: "Se vezmou",
    subject: "Confirm your launch announcement signup",
    heading: "Confirm your email",
    intro:
      "Thank you for your interest in Se vezmou. To send you the launch announcement, please confirm that this address is yours.",
    linkText: "Confirm signup",
    validity:
      "The link is valid for 7 days. Without confirmation we delete your address after that.",
    ignore:
      "If you did not sign up for the launch announcement, please ignore this message. We will not send you anything else.",
  },
} as const;

export function renderWaitlistConfirm({ locale, link }: WaitlistConfirmParams): RenderedEmail {
  const copy = COPY[locale];
  const blocks: Block[] = [
    { kind: "heading", text: copy.heading },
    { kind: "paragraph", text: copy.intro },
    { kind: "link", text: copy.linkText, href: link },
    { kind: "paragraph", text: copy.validity },
    { kind: "small", text: copy.ignore },
  ];
  return composeEmail(locale, copy.subject, blocks, copy.brand);
}
