import type { Locale } from "@/i18n/config";
import { composeEmail, type Block, type RenderedEmail } from "./shared";

/**
 * Upozornění hostům na změnu (docs/plan-funkci-2026-10.md, fáze 1). Posílá ho pár ze správy jen hostům,
 * kteří v odpovědi sami zaškrtli souhlas a nechali e-mail. Obsahuje text páru, odkaz na web svatby
 * a odkaz pro odhlášení (každá zpráva, jedním krokem na webu). Žádné údaje o jiných hostech.
 */

export type GuestUpdateParams = {
  locale: Locale;
  partners: { a: string; b: string };
  /** Text páru (prostý text; řádky se zachovají jako odstavce). */
  text: string;
  /** Adresa webu svatby v jazyce hosta. */
  siteUrl: string;
  /** Odkaz na odhlášení (stránka na webu svatby s potvrzením). */
  unsubscribeUrl: string;
};

const COPY = {
  cs: {
    brand: "Se vezmou",
    subject: (a: string, b: string) => `Změna u svatby ${a} a ${b}`,
    heading: "Novinka ke svatbě",
    intro: (a: string, b: string) => `${a} a ${b} vám posílají zprávu:`,
    linkText: "Otevřít web svatby",
    unsubscribe: "Odhlásit upozornění",
    why: "Tuto zprávu dostáváte, protože jste při potvrzení účasti zaškrtli, že chcete upozornění na změny. Odhlásit se můžete odkazem výše; vaše odpověď na pozvání zůstane beze změny.",
  },
  en: {
    brand: "Se vezmou",
    subject: (a: string, b: string) => `An update about the wedding of ${a} and ${b}`,
    heading: "Wedding update",
    intro: (a: string, b: string) => `${a} and ${b} are sending you a message:`,
    linkText: "Open the wedding website",
    unsubscribe: "Unsubscribe from updates",
    why: "You receive this message because you ticked the box for updates about changes when replying. You can unsubscribe with the link above; your reply to the invitation stays as it is.",
  },
} as const;

/** Odstavce z textu páru: prázdné řádky oddělují odstavce, jednotlivé řádky se spojí mezerou. */
function paragraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

export function renderGuestUpdate({
  locale,
  partners,
  text,
  siteUrl,
  unsubscribeUrl,
}: GuestUpdateParams): RenderedEmail {
  const copy = COPY[locale];
  const blocks: Block[] = [
    { kind: "heading", text: copy.heading },
    { kind: "paragraph", text: copy.intro(partners.a, partners.b) },
    ...paragraphs(text).map((part): Block => ({ kind: "paragraph", text: part })),
    { kind: "link", text: copy.linkText, href: siteUrl },
    { kind: "small", text: copy.why },
    { kind: "link", text: copy.unsubscribe, href: unsubscribeUrl },
  ];
  return composeEmail(locale, copy.subject(partners.a, partners.b), blocks, copy.brand);
}
