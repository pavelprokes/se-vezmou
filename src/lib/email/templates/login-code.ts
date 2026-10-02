import type { Locale } from "@/i18n/config";
import { composeEmail, formatPause, type Block, type RenderedEmail } from "./shared";

/** Přihlašovací kód správce: šestimístný kód a odkaz, platnost 10 minut, použitelné jednou. */

export type LoginCodeParams = {
  locale: Locale;
  code: string;
  /** Odkaz na potvrzovací stránku (nepřihlásí sám, aby ho nespotřeboval skener schránky). */
  link: string;
  ttlSeconds: number;
};

const COPY = {
  cs: {
    brand: "Se vezmou",
    subject: "Váš přihlašovací kód do správy svatby",
    heading: "Přihlášení do správy svatby",
    intro: "Váš přihlašovací kód:",
    validity: (ttl: string) => `Kód platí ${ttl} a jde použít jen jednou.`,
    linkIntro: "Nebo se přihlaste odkazem. Nejdřív vás požádáme o potvrzení.",
    linkText: "Pokračovat k přihlášení",
    ignore:
      "Pokud jste o přihlášení nežádali, tuto zprávu ignorujte. Kód nikomu nesdělujte, my se na něj nikdy neptáme.",
  },
  en: {
    brand: "Se vezmou",
    subject: "Your sign-in code for managing your wedding",
    heading: "Sign in to manage your wedding",
    intro: "Your sign-in code:",
    validity: (ttl: string) => `The code is valid for ${ttl} and can be used only once.`,
    linkIntro: "Or sign in with a link. We will ask you to confirm first.",
    linkText: "Continue to sign in",
    ignore:
      "If you did not ask to sign in, please ignore this message. Do not share the code with anyone; we never ask for it.",
  },
} as const;

export function renderLoginCode({
  locale,
  code,
  link,
  ttlSeconds,
}: LoginCodeParams): RenderedEmail {
  const copy = COPY[locale];
  const blocks: Block[] = [
    { kind: "heading", text: copy.heading },
    { kind: "paragraph", text: copy.intro },
    { kind: "code", text: code },
    { kind: "paragraph", text: copy.validity(formatPause(ttlSeconds, locale)) },
    { kind: "paragraph", text: copy.linkIntro },
    { kind: "link", text: copy.linkText, href: link },
    { kind: "small", text: copy.ignore },
  ];
  return composeEmail(locale, copy.subject, blocks, copy.brand);
}
