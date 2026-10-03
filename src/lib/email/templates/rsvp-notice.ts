import type { Locale } from "@/i18n/config";
import { composeEmail, type Block, type RenderedEmail } from "./shared";

/**
 * Upozornění páru na odpověď hosta (volitelné, jen když pár zapnul `notify_couple`). Obsahuje jen
 * jména a to, kdo přijde na kterou událost. NIKDY dietu, alergie, kontaktní e-mail hosta ani volné
 * odpovědi na otázky (docs/security-privacy.md kap. 4): ty jsou ve správě za přihlášením.
 */

export type RsvpNoticeParams = {
  locale: Locale;
  partners: { a: string; b: string };
  /** Host odpověděl poprvé, nebo svou odpověď změnil. */
  kind: "new" | "changed";
  /** Host mimo seznam (odpověď bez pozvánky). */
  unlisted: boolean;
  /** Kdo přijde na kterou událost (texty událostí už jsou ve správném jazyce). */
  people: { name: string; rows: { event: string; attending: boolean }[] }[];
  /** Odkaz na přehled odpovědí ve správě. */
  manageUrl: string;
};

const COPY = {
  cs: {
    brand: "Se vezmou",
    subject: (kind: "new" | "changed") =>
      kind === "new" ? "Nová odpověď na svatbu" : "Host změnil odpověď na svatbu",
    heading: (kind: "new" | "changed") =>
      kind === "new" ? "Nová odpověď hosta" : "Host změnil odpověď",
    intro: (a: string, b: string) => `K svatbě ${a} a ${b} přišla odpověď. Shrnutí:`,
    unlisted: "Odpověděl host mimo seznam, bez pozvánky.",
    attending: "přijde",
    declining: "nepřijde",
    linkText: "Otevřít odpovědi ve správě",
    why: "Tuto zprávu dostáváte, protože máte v nastavení RSVP zapnuté upozornění na odpovědi. Vypnete ho tamtéž. Dietní a alergické údaje do zprávy nikdy nezařazujeme, najdete je ve správě.",
  },
  en: {
    brand: "Se vezmou",
    subject: (kind: "new" | "changed") =>
      kind === "new" ? "New reply to your wedding" : "A guest changed their reply",
    heading: (kind: "new" | "changed") =>
      kind === "new" ? "New guest reply" : "A guest changed their reply",
    intro: (a: string, b: string) => `A reply came in for the wedding of ${a} and ${b}. Summary:`,
    unlisted: "A guest who is not on the list replied, without an invitation.",
    attending: "attending",
    declining: "not attending",
    linkText: "Open the replies in the management",
    why: "You receive this message because reply notifications are switched on in your RSVP settings. You can switch them off there. Dietary and allergy details are never included in this message, you will find them in the management.",
  },
} as const;

/**
 * Host mimo seznam píše jméno sám a e-mail jde z naší domény: odkazy ve jménu se vyřežou a délka
 * omezí, aby z upozornění nešla udělat návnada na cizí stránku.
 */
function safeName(name: string): string {
  return name
    .replace(/(?:https?:\/\/|www\.)\S+/gi, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function renderRsvpNotice({
  locale,
  partners,
  kind,
  unlisted,
  people,
  manageUrl,
}: RsvpNoticeParams): RenderedEmail {
  const copy = COPY[locale];
  const blocks: Block[] = [
    { kind: "heading", text: copy.heading(kind) },
    { kind: "paragraph", text: copy.intro(partners.a, partners.b) },
    ...(unlisted ? [{ kind: "paragraph", text: copy.unlisted } as const] : []),
    ...people.map((person): Block => ({
      kind: "list",
      text: safeName(person.name),
      items: person.rows.map(
        (row) => `${row.event}: ${row.attending ? copy.attending : copy.declining}`,
      ),
    })),
    { kind: "link", text: copy.linkText, href: manageUrl },
    { kind: "small", text: copy.why },
  ];
  return composeEmail(locale, copy.subject(kind), blocks, copy.brand);
}
