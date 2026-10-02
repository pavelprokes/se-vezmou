import type { Locale } from "@/i18n/config";
import { composeEmail, type Block, type RenderedEmail } from "./shared";

/**
 * Potvrzení odpovědi hostovi (FR-RSVP-6, volitelné, jen když pár zapnul `email_confirmation` a host
 * zadal adresu). Obsahuje jen to, co host sám odeslal a vidí na obrazovce: kdo přijde na kterou
 * událost. NIKDY dietu, alergie ani jiné zdravotní údaje (docs/security-privacy.md kap. 4).
 */

export type RsvpConfirmationParams = {
  locale: Locale;
  /** Jména páru ("Klára", "Matěj"). */
  partners: { a: string; b: string };
  /** Kdo přijde na kterou událost (texty událostí už jsou ve správném jazyce). */
  people: { name: string; rows: { event: string; attending: boolean }[] }[];
  /** Odkaz na sekci potvrzení účasti na webu páru (úprava odpovědi přes ověření jména). */
  editUrl: string;
  /** Host mimo seznam: odpověď nejde upravit, text to říká. */
  unlisted: boolean;
};

const COPY = {
  cs: {
    brand: "Se vezmou",
    subject: (a: string, b: string) => `Potvrzení vaší odpovědi: svatba ${a} a ${b}`,
    heading: "Děkujeme za odpověď",
    intro: (a: string, b: string) => `Vaši odpověď na svatbu ${a} a ${b} jsme uložili. Shrnutí:`,
    attending: "přijdu",
    declining: "nepřijdu",
    edit: "Odpověď můžete do uzavření potvrzování změnit na webu svatby. Požádáme vás znovu o vaše jméno.",
    editUnlisted:
      "Tuto odpověď už nejde na webu změnit. Pokud potřebujete změnu, napište prosím páru.",
    linkText: "Otevřít web svatby",
    why: "Tuto zprávu jste dostali, protože jste při odpovědi zadali svou e-mailovou adresu. Používáme ji jen k tomuto potvrzení. Dietní a alergické údaje do zprávy nikdy nezařazujeme.",
  },
  en: {
    brand: "Se vezmou",
    subject: (a: string, b: string) => `Your reply is confirmed: wedding of ${a} and ${b}`,
    heading: "Thank you for replying",
    intro: (a: string, b: string) =>
      `We have saved your reply to the wedding of ${a} and ${b}. Summary:`,
    attending: "attending",
    declining: "not attending",
    edit: "You can change your reply on the wedding website until replies close. We will ask for your name again.",
    editUnlisted:
      "This reply can no longer be changed on the website. If you need a change, please write to the couple.",
    linkText: "Open the wedding website",
    why: "You received this message because you entered your email address when replying. We use it only for this confirmation. Dietary and allergy details are never included in this message.",
  },
} as const;

export function renderRsvpConfirmation({
  locale,
  partners,
  people,
  editUrl,
  unlisted,
}: RsvpConfirmationParams): RenderedEmail {
  const copy = COPY[locale];
  const blocks: Block[] = [
    { kind: "heading", text: copy.heading },
    { kind: "paragraph", text: copy.intro(partners.a, partners.b) },
    ...people.map((person): Block => ({
      kind: "list",
      text: person.name,
      items: person.rows.map(
        (row) => `${row.event}: ${row.attending ? copy.attending : copy.declining}`,
      ),
    })),
    { kind: "paragraph", text: unlisted ? copy.editUnlisted : copy.edit },
    ...(unlisted ? [] : [{ kind: "link", text: copy.linkText, href: editUrl } as const]),
    { kind: "small", text: copy.why },
  ];
  return composeEmail(locale, copy.subject(partners.a, partners.b), blocks, copy.brand);
}
