import type { Locale } from "@/i18n/config";
import { composeEmail, formatEventDay, type Block, type RenderedEmail } from "./shared";

/**
 * Zpráva správcům o skutečném smazání (FR-LC-2, docs/security-privacy.md kap. 6): údaje hostů podle retence
 * nebo trvalé smazání webu. Neobsahuje žádné osobní údaje, jen co a kdy se smazalo. U smazaného webu
 * není odkaz (není kam se přihlásit); adresa webu se nikomu dalšímu nepřidělí (FR-PRIV-4).
 */

export type DeletionNoticeKind = "health_purge" | "guest_purge" | "site_purge";

export type DeletionNoticeParams = {
  locale: Locale;
  kind: DeletionNoticeKind;
  /** Okamžik smazání. */
  at: Date;
  timeZone: string;
  site?: string;
  /** Odkaz na přihlášení (u `site_purge` se nepoužije). */
  loginUrl?: string;
};

type KindCopy = {
  subject: string;
  heading: string;
  body: (when: string, site: string | undefined) => string;
  next?: string;
};

type Copy = {
  brand: string;
  kinds: Record<DeletionNoticeKind, KindCopy>;
  linkText: string;
  small: string;
};

const COPY: Record<Locale, Copy> = {
  cs: {
    brand: "Se vezmou",
    kinds: {
      health_purge: {
        subject: "Dietní a alergické údaje hostů jsme smazali",
        heading: "Dietní a alergické údaje hostů jsme smazali",
        body: (when, site) =>
          `Dne ${when} jsme ${site ? `ze svatebního webu ${site}` : "z vašeho svatebního webu"} nevratně smazali dietní a alergické údaje hostů.`,
        next: "Ostatní údaje hostů zůstávají do konce stanovené lhůty.",
      },
      guest_purge: {
        subject: "Údaje hostů jsme smazali",
        heading: "Údaje hostů jsme smazali",
        body: (when, site) =>
          `Dne ${when} jsme ${site ? `ze svatebního webu ${site}` : "z vašeho svatebního webu"} nevratně smazali údaje hostů: seznam hostů, pozvání a odpovědi na RSVP, včetně případných dietních a alergických údajů.`,
        next: "Obsah svatebního webu zůstává beze změny.",
      },
      site_purge: {
        subject: "Svatební web jsme trvale smazali",
        heading: "Svatební web jsme trvale smazali",
        body: (when, site) =>
          `Dne ${when} jsme nevratně smazali ${site ? `svatební web ${site}` : "váš svatební web"} se všemi údaji a fotografiemi.`,
        next: "Adresa webu se nikomu dalšímu nepřidělí.",
      },
    },
    linkText: "Přejít k přihlášení",
    small:
      "Tuto zprávu dostáváte jako správce svatebního webu. Neobsahuje žádné osobní údaje hostů.",
  },
  en: {
    brand: "Se vezmou",
    kinds: {
      health_purge: {
        subject: "We deleted guests’ dietary and allergy details",
        heading: "We deleted guests’ dietary and allergy details",
        body: (when, site) =>
          `On ${when} we irreversibly deleted guests’ dietary and allergy details from ${site ? `the wedding website ${site}` : "your wedding website"}.`,
        next: "Other guest data remains until the end of its retention period.",
      },
      guest_purge: {
        subject: "We deleted guest data",
        heading: "We deleted guest data",
        body: (when, site) =>
          `On ${when} we irreversibly deleted guest data from ${site ? `the wedding website ${site}` : "your wedding website"}: the guest list, invitations and RSVP replies, including any dietary and allergy details.`,
        next: "The content of the wedding website is unchanged.",
      },
      site_purge: {
        subject: "We permanently deleted the wedding website",
        heading: "We permanently deleted the wedding website",
        body: (when, site) =>
          `On ${when} we irreversibly deleted ${site ? `the wedding website ${site}` : "your wedding website"} with all its data and photos.`,
        next: "The address of the website will not be given to anyone else.",
      },
    },
    linkText: "Go to sign-in",
    small:
      "You are receiving this message as an administrator of the wedding website. It contains no personal data of guests.",
  },
};

export function renderDeletionNotice({
  locale,
  kind,
  at,
  timeZone,
  site,
  loginUrl,
}: DeletionNoticeParams): RenderedEmail {
  const copy = COPY[locale];
  const kindCopy = copy.kinds[kind];
  const when = formatEventDay(at, locale, timeZone);

  const blocks: Block[] = [
    { kind: "heading", text: kindCopy.heading },
    { kind: "paragraph", text: kindCopy.body(when, site) },
    ...(kindCopy.next ? [{ kind: "paragraph", text: kindCopy.next } as Block] : []),
    ...(kind !== "site_purge" && loginUrl
      ? [{ kind: "link", text: copy.linkText, href: loginUrl } as Block]
      : []),
    { kind: "small", text: copy.small },
  ];
  return composeEmail(locale, kindCopy.subject, blocks, copy.brand);
}
