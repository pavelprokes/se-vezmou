import type { Locale } from "@/i18n/config";
import { composeEmail, formatPause, type Block, type RenderedEmail } from "./shared";

/**
 * Ověření e-mailu při prvním uložení v průvodci: šestimístný kód, platnost 10 minut, použitelný
 * jednou. Bez odkazu: kód se opisuje nebo vkládá do průvodce, který má koncept rozepsaný v
 * prohlížeči, a odkaz z jiného zařízení by ho neznal.
 */

export type WizardCodeParams = {
  locale: Locale;
  code: string;
  ttlSeconds: number;
};

const COPY = {
  cs: {
    brand: "Se vezmou",
    subject: (code: string) => `${code} je váš ověřovací kód pro Se vezmou`,
    heading: "Ověřte svůj e-mail",
    intro: "Váš ověřovací kód:",
    validity: (ttl: string) => `Kód platí ${ttl} a jde použít jen jednou.`,
    next: "Zadejte ho v průvodce, kde jste web začali vytvářet. Teprve potom rezervujeme adresu vašeho webu.",
    ignore:
      "Pokud jste žádný web nezakládali, tuto zprávu ignorujte. Kód nikomu nesdělujte, my se na něj nikdy neptáme.",
  },
  en: {
    brand: "Se vezmou",
    subject: (code: string) => `${code} is your verification code for Se vezmou`,
    heading: "Verify your email",
    intro: "Your verification code:",
    validity: (ttl: string) => `The code is valid for ${ttl} and can be used only once.`,
    next: "Enter it in the guide where you started creating your website. Only then do we reserve your website address.",
    ignore:
      "If you did not start creating a website, please ignore this message. Do not share the code with anyone; we never ask for it.",
  },
} as const;

export function renderWizardCode({ locale, code, ttlSeconds }: WizardCodeParams): RenderedEmail {
  const copy = COPY[locale];
  const blocks: Block[] = [
    { kind: "heading", text: copy.heading },
    { kind: "paragraph", text: copy.intro },
    { kind: "code", text: code },
    { kind: "paragraph", text: copy.validity(formatPause(ttlSeconds, locale)) },
    { kind: "paragraph", text: copy.next },
    { kind: "small", text: copy.ignore },
  ];
  return composeEmail(locale, copy.subject(code), blocks, copy.brand);
}
