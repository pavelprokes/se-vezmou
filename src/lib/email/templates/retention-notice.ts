import { getEmailPixelUrl } from "../pixel";
import type { Locale } from "@/i18n/config";
import { composeEmail, formatEventDay, type Block, type RenderedEmail } from "./shared";

/**
 * Upozornění správcům před vypršením webu a před smazáním údajů (FR-LC-2, FR-MAIL-1, docs/security-privacy.md
 * kap. 6): „first“ několik dní předem (app_settings.retention_notice_days_before) a „final“ těsně před událostí.
 * Zpráva nese jen datum, adresu webu a odkaz na stránku exportu ve správě, nikdy osobní údaje hostů. Export hostů,
 * odpovědí a fotografií stahuje správce po přihlášení (odkaz vyžaduje přihlášení, žádný veřejný export).
 */

/** Pixel jen u vypršení webu; oznámení o zdravotních a hostových údajích ho nemají (ADR 0014). */
export type RetentionNoticeKind = "site_expiry" | "health_purge" | "guest_purge";

export type RetentionNoticeParams = {
  locale: Locale;
  kind: RetentionNoticeKind;
  stage: "first" | "final";
  /** Okamžik události (smazání, archivace). */
  eventAt: Date;
  /** Pásmo svatby: určuje, který kalendářní den se uvede. */
  timeZone: string;
  /** Adresa webu ("klara-a-matej.se-vezmou.cz"), pokud ji svatba má. */
  site?: string;
  /** Odkaz na stránku exportu ve správě (`/data`); bez přihlášení vede přes přihlášení. */
  exportUrl: string;
};

type KindCopy = {
  subject: (when: string) => string;
  heading: string;
  body: (when: string, site: string | undefined) => string;
  todo: string;
};

type Copy = {
  brand: string;
  reminder: string;
  finalLead: string;
  kinds: Record<RetentionNoticeKind, KindCopy>;
  afterLogin: string;
  linkText: string;
  small: string;
};

const COPY: Record<Locale, Copy> = {
  cs: {
    brand: "Se vezmou",
    reminder: "Připomenutí: ",
    finalLead: "Píšeme vám naposledy před touto událostí.",
    kinds: {
      health_purge: {
        subject: (when) => `Dietní a alergické údaje hostů se smažou ${when}`,
        heading: "Brzy smažeme dietní a alergické údaje hostů",
        body: (when, site) =>
          `Dne ${when} automaticky a nevratně smažeme dietní a alergické údaje hostů ${site ? `ze svatebního webu ${site}` : "z vašeho svatebního webu"}. Jde o zdravotní údaje, proto je uchováváme jen krátce po svatbě.`,
        todo: "Pokud je potřebujete uchovat, stáhněte si před tím export hostů a odpovědí (CSV nebo Excel), včetně dietních údajů.",
      },
      guest_purge: {
        subject: (when) => `Údaje hostů se smažou ${when}`,
        heading: "Brzy smažeme údaje hostů",
        body: (when, site) =>
          `Dne ${when} automaticky a nevratně smažeme ${site ? `ze svatebního webu ${site}` : "z vašeho svatebního webu"} údaje hostů: seznam hostů, pozvání a odpovědi na RSVP.`,
        todo: "Pokud je potřebujete uchovat, stáhněte si před tím export hostů a odpovědí (CSV nebo Excel) a fotografií.",
      },
      site_expiry: {
        subject: (when) => `Váš svatební web přestane být veřejný ${when}`,
        heading: "Váš svatební web brzy přestane být veřejný",
        body: (when, site) =>
          `Dne ${when} ${site ? `váš svatební web ${site}` : "váš svatební web"} přestane být veřejný. Údaje hostů se dál mažou podle stanovených lhůt po svatbě.`,
        todo: "Než k tomu dojde, stáhněte si export hostů a odpovědí (CSV nebo Excel) a fotografií.",
      },
    },
    afterLogin:
      "Odkaz vede do správy svatebního webu na stránku Data a smazání. Pokud nejste přihlášení, nejdřív se přihlaste; upozornění pak najdete i v přehledu správy.",
    linkText: "Stáhnout export",
    small:
      "Tuto zprávu dostáváte jako správce svatebního webu. Neobsahuje žádné osobní údaje hostů.",
  },
  en: {
    brand: "Se vezmou",
    reminder: "Reminder: ",
    finalLead: "This is the last time we write to you before this happens.",
    kinds: {
      health_purge: {
        subject: (when) => `Guests’ dietary and allergy details will be deleted on ${when}`,
        heading: "We will soon delete guests’ dietary and allergy details",
        body: (when, site) =>
          `On ${when} we will automatically and irreversibly delete guests’ dietary and allergy details from ${site ? `the wedding website ${site}` : "your wedding website"}. These are health data, so we keep them only briefly after the wedding.`,
        todo: "If you need to keep them, download the export of guests and replies (CSV or Excel), including the dietary details, before then.",
      },
      guest_purge: {
        subject: (when) => `Guest data will be deleted on ${when}`,
        heading: "We will soon delete guest data",
        body: (when, site) =>
          `On ${when} we will automatically and irreversibly delete guest data from ${site ? `the wedding website ${site}` : "your wedding website"}: the guest list, invitations and RSVP replies.`,
        todo: "If you need to keep it, download the export of guests and replies (CSV or Excel) and of photos before then.",
      },
      site_expiry: {
        subject: (when) => `Your wedding website stops being public on ${when}`,
        heading: "Your wedding website will soon stop being public",
        body: (when, site) =>
          `On ${when} ${site ? `your wedding website ${site}` : "your wedding website"} stops being public. Guest data continues to be deleted within the set periods after the wedding.`,
        todo: "Before that, download the export of guests and replies (CSV or Excel) and of photos.",
      },
    },
    afterLogin:
      "The link opens the Data and deletion page in your wedding website settings. If you are not signed in, sign in first; you will also see the reminder on the overview.",
    linkText: "Download the export",
    small:
      "You are receiving this message as an administrator of the wedding website. It contains no personal data of guests.",
  },
};

export function renderRetentionNotice({
  locale,
  kind,
  stage,
  eventAt,
  timeZone,
  site,
  exportUrl,
}: RetentionNoticeParams): RenderedEmail {
  const copy = COPY[locale];
  const kindCopy = copy.kinds[kind];
  const when = formatEventDay(eventAt, locale, timeZone);

  const blocks: Block[] = [
    { kind: "heading", text: kindCopy.heading },
    ...(stage === "final" ? [{ kind: "paragraph", text: copy.finalLead } as Block] : []),
    { kind: "paragraph", text: kindCopy.body(when, site) },
    { kind: "paragraph", text: kindCopy.todo },
    { kind: "link", text: copy.linkText, href: exportUrl },
    { kind: "paragraph", text: copy.afterLogin },
    { kind: "small", text: copy.small },
  ];
  const subject = `${stage === "final" ? copy.reminder : ""}${kindCopy.subject(when)}`;
  return composeEmail(
    locale,
    subject,
    blocks,
    copy.brand,
    kind === "site_expiry" ? getEmailPixelUrl("smazani-upozorneni") : null,
  );
}
