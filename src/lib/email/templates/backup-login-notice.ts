import type { Locale } from "@/i18n/config";
import { composeEmail, formatMoment, formatPause, type Block, type RenderedEmail } from "./shared";

/**
 * Oznámení na záložní e-mail: přihlášení PINem do správy (každé), případně pozastavení zadávání
 * PINu po sérii chyb (docs/security-privacy.md kap. 1.2, ADR 0010).
 */

export type BackupLoginNoticeParams = {
  locale: Locale;
  event: "pin_login" | "pin_locked" | "pin_changed";
  at: Date;
  /** Adresa webu ("klara-a-matej.se-vezmou.cz"), pokud ji svatba už má. */
  site?: string;
  /** U `pin_changed`: který PIN se změnil (správy, nebo hostů). */
  pinRole?: "admin" | "guest";
  /** U `pin_locked`: délka pauzy v sekundách. */
  pauseSeconds?: number;
  /** Odkaz na přihlášení (kód z e-mailu, změna PINu). */
  loginUrl: string;
};

const COPY = {
  cs: {
    brand: "Se vezmou",
    subjects: {
      pin_login: "Přihlášení PINem do správy vašeho svatebního webu",
      pin_locked: "Opakovaně chybný PIN ke správě vašeho svatebního webu",
      pin_changed: "Změna PINu u vašeho svatebního webu",
    },
    headings: {
      pin_login: "Někdo se přihlásil PINem",
      pin_locked: "Zadávání PINu je pozastaveno",
      pin_changed: "PIN byl změněn",
    },
    pinLogin: (site: string, when: string) =>
      `Do správy svatebního webu ${site} se ${when} přihlásil někdo správným PINem.`,
    pinLoginNoSite: (when: string) =>
      `Do správy vašeho svatebního webu se ${when} přihlásil někdo správným PINem.`,
    pinLocked: (site: string, pause: string) =>
      `PIN ke správě svatebního webu ${site} byl několikrát po sobě zadán chybně. Zadávání PINu jsme pozastavili na ${pause}.`,
    pinLockedNoSite: (pause: string) =>
      `PIN ke správě vašeho svatebního webu byl několikrát po sobě zadán chybně. Zadávání PINu jsme pozastavili na ${pause}.`,
    pinChanged: (what: string, site: string, when: string) =>
      `${what} svatebního webu ${site} byl ${when} změněn.`,
    pinChangedNoSite: (what: string, when: string) =>
      `${what} vašeho svatebního webu byl ${when} změněn.`,
    pinAdmin: "PIN ke správě",
    pinGuest: "PIN pro hosty",
    changedNotYou:
      "Pokud jste změnu neprovedli vy ani druhý z vás, přihlaste se kódem z e-mailu a PIN změňte znovu.",
    fine: "Pokud jste to byli vy nebo druhý z vás, nemusíte nic dělat.",
    notYou:
      "Pokud ne, přihlaste se kódem z e-mailu a PIN změňte. Změna PINu ukončí přihlášení na ostatních zařízeních.",
    stillCode: "Do správy se dostanete i bez PINu, kódem z e-mailu.",
    linkText: "Přejít k přihlášení",
    why: "Tuto zprávu dostáváte, protože je tato adresa uvedena jako záložní e-mail svatebního webu.",
  },
  en: {
    brand: "Se vezmou",
    subjects: {
      pin_login: "PIN sign-in to your wedding website",
      pin_locked: "Repeated wrong PIN for your wedding website",
      pin_changed: "PIN changed on your wedding website",
    },
    headings: {
      pin_login: "Someone signed in with the PIN",
      pin_locked: "PIN entry is paused",
      pin_changed: "The PIN was changed",
    },
    pinLogin: (site: string, when: string) =>
      `Someone signed in to manage the wedding website ${site} with the correct PIN on ${when}.`,
    pinLoginNoSite: (when: string) =>
      `Someone signed in to manage your wedding website with the correct PIN on ${when}.`,
    pinLocked: (site: string, pause: string) =>
      `The PIN for managing the wedding website ${site} was entered incorrectly several times in a row. We have paused PIN entry for ${pause}.`,
    pinLockedNoSite: (pause: string) =>
      `The PIN for managing your wedding website was entered incorrectly several times in a row. We have paused PIN entry for ${pause}.`,
    pinChanged: (what: string, site: string, when: string) =>
      `${what} for the wedding website ${site} was changed on ${when}.`,
    pinChangedNoSite: (what: string, when: string) =>
      `${what} for your wedding website was changed on ${when}.`,
    pinAdmin: "The management PIN",
    pinGuest: "The guest PIN",
    changedNotYou:
      "If neither you nor your partner made the change, sign in with a code sent by e-mail and change the PIN again.",
    fine: "If that was you or your partner, you do not need to do anything.",
    notYou:
      "If not, sign in with a code sent by e-mail and change the PIN. Changing the PIN signs out all other devices.",
    stillCode: "You can still get in without the PIN, with a code sent by e-mail.",
    linkText: "Go to sign-in",
    why: "You are receiving this message because this address is the backup e-mail of the wedding website.",
  },
} as const;

export function renderBackupLoginNotice({
  locale,
  event,
  at,
  site,
  pinRole,
  pauseSeconds,
  loginUrl,
}: BackupLoginNoticeParams): RenderedEmail {
  const copy = COPY[locale];
  const when = formatMoment(at, locale);
  const pause = formatPause(pauseSeconds ?? 900, locale);

  const what = pinRole === "guest" ? copy.pinGuest : copy.pinAdmin;

  const blocks: Block[] =
    event === "pin_changed"
      ? [
          { kind: "heading", text: copy.headings.pin_changed },
          {
            kind: "paragraph",
            text: site ? copy.pinChanged(what, site, when) : copy.pinChangedNoSite(what, when),
          },
          { kind: "paragraph", text: copy.changedNotYou },
          { kind: "link", text: copy.linkText, href: loginUrl },
          { kind: "small", text: copy.why },
        ]
      : event === "pin_login"
        ? [
            { kind: "heading", text: copy.headings.pin_login },
            {
              kind: "paragraph",
              text: site ? copy.pinLogin(site, when) : copy.pinLoginNoSite(when),
            },
            { kind: "paragraph", text: copy.fine },
            { kind: "paragraph", text: copy.notYou },
            { kind: "link", text: copy.linkText, href: loginUrl },
            { kind: "small", text: copy.why },
          ]
        : [
            { kind: "heading", text: copy.headings.pin_locked },
            {
              kind: "paragraph",
              text: site ? copy.pinLocked(site, pause) : copy.pinLockedNoSite(pause),
            },
            { kind: "paragraph", text: copy.fine },
            { kind: "paragraph", text: copy.stillCode },
            { kind: "link", text: copy.linkText, href: loginUrl },
            { kind: "small", text: copy.why },
          ];

  return composeEmail(locale, copy.subjects[event], blocks, copy.brand);
}
