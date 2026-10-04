import type { Locale } from "@/i18n/config";
import { composeEmail, type Block, type RenderedEmail } from "./shared";

/**
 * Potvrzení odběru novinek (newsletter, tabulka `waitlist`, double opt-in): odkaz vede na stránku s tlačítkem, adresa se zapíše až po
 * jeho stisknutí (skener pošty, který odkaz otevře, nic nepotvrdí). Odkaz platí 7 dní.
 */

export type WaitlistConfirmParams = {
  locale: Locale;
  link: string;
};

const COPY = {
  cs: {
    brand: "Se vezmou",
    subject: "Potvrďte odběr novinek",
    heading: "Potvrďte svůj e-mail",
    intro:
      "Děkujeme za zájem o Se vezmou. Abychom vám mohli posílat novinky, potvrďte prosím, že tato adresa patří vám.",
    linkText: "Potvrdit odběr",
    validity: "Odkaz platí 7 dní. Bez potvrzení vaši adresu po této době smažeme.",
    ignore:
      "Pokud jste se k odběru novinek nehlásili, tuto zprávu ignorujte. Nic dalšího vám neposíláme.",
  },
  en: {
    brand: "Se vezmou",
    subject: "Confirm your news subscription",
    heading: "Confirm your email",
    intro:
      "Thank you for your interest in Se vezmou. To send you our news, please confirm that this address is yours.",
    linkText: "Confirm subscription",
    validity:
      "The link is valid for 7 days. Without confirmation we delete your address after that.",
    ignore:
      "If you did not subscribe to our news, please ignore this message. We will not send you anything else.",
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
