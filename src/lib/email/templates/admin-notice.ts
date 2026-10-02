import type { Locale } from "@/i18n/config";
import {
  composeEmail,
  formatEventDay,
  formatMoment,
  type Block,
  type RenderedEmail,
} from "./shared";

/**
 * Oznámení o změnách přístupu ke správě webu (M7b, docs/security-privacy.md kap. 5): přidání a odebrání
 * správce, změna záložního e-mailu, souhlas s nahlédnutím provozovatele (udělení, odvolání, skutečné
 * nahlédnutí, OQ-53) a smazání webu. Zprávy nesou jen druh změny, čas, adresu webu a odkaz na
 * přihlášení; nikdy jména hostů ani údaje z webu. E-mailové adresy dotčených osob se do zpráv
 * nevkládají (příjemce ví, komu zpráva patří).
 */

export type AdminNoticeKind =
  /** Novému správci: byl přidán, přihlásí se kódem z e-mailu. */
  | "admin_added"
  /** Ostatním správcům a záložní adrese: byl přidán další správce. */
  | "admin_added_others"
  /** Odebranému správci: ztratil přístup. */
  | "admin_removed"
  /** Ostatním správcům a záložní adrese: správce byl odebrán. */
  | "admin_removed_others"
  /** Staré záložní adrese: už není záložní. */
  | "backup_changed_old"
  /** Správcům a nové záložní adrese: záložní adresa se změnila. */
  | "backup_changed"
  | "operator_access_granted"
  | "operator_access_revoked"
  | "guest_data_viewed"
  | "site_deleted";

export type AdminNoticeParams = {
  locale: Locale;
  kind: AdminNoticeKind;
  at: Date;
  /** Adresa webu ("klara-a-matej.se-vezmou.cz"), má-li ho svatba. */
  site?: string;
  /** Odkaz na přihlášení (kromě `site_deleted`, kde se neuvádí). */
  loginUrl?: string;
  /** `operator_access_granted`: do kdy souhlas platí; `site_deleted`: do kdy jde web obnovit. */
  until?: Date;
  /** Časové pásmo svatby pro datum `until`. */
  timeZone?: string;
  /** `guest_data_viewed`: důvod, který uvedl provozovatel. */
  reason?: string;
};

type Copy = {
  subject: string;
  heading: string;
  body: string[];
  link: boolean;
};

function copyFor(p: AdminNoticeParams, when: string, until: string | null, site: string): Copy {
  const cs = p.locale === "cs";
  const siteText = site ? ` ${site}` : "";
  switch (p.kind) {
    case "admin_added":
      return cs
        ? {
            subject: "Byli jste přidáni do správy svatebního webu",
            heading: "Máte přístup ke správě svatebního webu",
            body: [
              `Někdo z páru vás ${when} přidal mezi správce svatebního webu${siteText}. Můžete upravovat web, spravovat hosty a jejich odpovědi.`,
              "Přihlásíte se svým e-mailem: na přihlašovací stránce zadáte tuto adresu a z e-mailu vám přijde jednorázový kód.",
              "Pokud jste o přístup nežádali, ozvěte se páru a tuto zprávu ignorujte.",
            ],
            link: true,
          }
        : {
            subject: "You have been added to the wedding website",
            heading: "You can now manage the wedding website",
            body: [
              `One of the couple added you as an administrator of the wedding website${siteText} on ${when}. You can edit the website and manage guests and their replies.`,
              "Sign in with this e-mail address: enter it on the sign-in page and we will send you a one-time code.",
              "If you did not expect this, contact the couple and ignore this message.",
            ],
            link: true,
          };
    case "admin_added_others":
      return cs
        ? {
            subject: "Do správy vašeho svatebního webu byl přidán další správce",
            heading: "Přibyl správce svatebního webu",
            body: [
              `Do správy svatebního webu${siteText} byl ${when} přidán další správce. Má přístup k úpravám webu a k údajům hostů.`,
              "Pokud o tom nevíte, přihlaste se a zkontrolujte seznam správců.",
            ],
            link: true,
          }
        : {
            subject: "Another administrator was added to your wedding website",
            heading: "A new administrator was added",
            body: [
              `Another administrator was added to the wedding website${siteText} on ${when}. They can edit the website and see guest data.`,
              "If you do not know about this, sign in and check the list of administrators.",
            ],
            link: true,
          };
    case "admin_removed":
      return cs
        ? {
            subject: "Váš přístup ke správě svatebního webu skončil",
            heading: "Přístup byl ukončen",
            body: [
              `Váš přístup ke správě svatebního webu${siteText} byl ${when} ukončen. Všechna vaše přihlášení byla odhlášena.`,
            ],
            link: false,
          }
        : {
            subject: "Your access to the wedding website has ended",
            heading: "Your access has ended",
            body: [
              `Your access to manage the wedding website${siteText} was ended on ${when}. All your sessions were signed out.`,
            ],
            link: false,
          };
    case "admin_removed_others":
      return cs
        ? {
            subject: "Ze správy vašeho svatebního webu byl odebrán správce",
            heading: "Správce byl odebrán",
            body: [
              `Ze správy svatebního webu${siteText} byl ${when} odebrán jeden správce. Jeho přihlášení byla odhlášena.`,
              "Pokud o tom nevíte, přihlaste se a zkontrolujte seznam správců.",
            ],
            link: true,
          }
        : {
            subject: "An administrator was removed from your wedding website",
            heading: "An administrator was removed",
            body: [
              `An administrator of the wedding website${siteText} was removed on ${when}. Their sessions were signed out.`,
              "If you do not know about this, sign in and check the list of administrators.",
            ],
            link: true,
          };
    case "backup_changed_old":
      return cs
        ? {
            subject: "Tato adresa už není záložní e-mail svatebního webu",
            heading: "Záložní e-mail byl změněn",
            body: [
              `Záložní e-mail svatebního webu${siteText} byl ${when} změněn na jinou adresu. Tato adresa už oznámení nedostává.`,
              "Pokud jste změnu nečekali, ozvěte se páru.",
            ],
            link: false,
          }
        : {
            subject: "This address is no longer the backup e-mail of the wedding website",
            heading: "The backup e-mail was changed",
            body: [
              `The backup e-mail of the wedding website${siteText} was changed to another address on ${when}. This address will no longer receive notices.`,
              "If you did not expect this, contact the couple.",
            ],
            link: false,
          };
    case "backup_changed":
      return cs
        ? {
            subject: "Záložní e-mail vašeho svatebního webu se změnil",
            heading: "Záložní e-mail byl změněn",
            body: [
              `Záložní e-mail svatebního webu${siteText} byl ${when} změněn. Na tuto adresu chodí oznámení o přihlášení a o změnách PINu.`,
              "Pokud jste změnu neprovedli vy ani druhý z vás, přihlaste se a zkontrolujte přístup.",
            ],
            link: true,
          }
        : {
            subject: "The backup e-mail of your wedding website was changed",
            heading: "The backup e-mail was changed",
            body: [
              `The backup e-mail of the wedding website${siteText} was changed on ${when}. Notices about sign-ins and PIN changes are sent to it.`,
              "If neither you nor your partner made the change, sign in and check the access settings.",
            ],
            link: true,
          };
    case "operator_access_granted":
      return cs
        ? {
            subject: "Udělen souhlas s nahlédnutím provozovatele do údajů hostů",
            heading: "Souhlas s nahlédnutím byl udělen",
            body: [
              `Správce svatebního webu${siteText} ${when} udělil provozovateli služby souhlas s nahlédnutím do údajů hostů${until ? `, platný do ${until}` : ""}. Provozovatel smí údaje použít jen k vyřešení potíží, o každém nahlédnutí vás budeme informovat.`,
              "Souhlas můžete kdykoli odvolat v části Přístup.",
            ],
            link: true,
          }
        : {
            subject: "Consent to operator access to guest data was granted",
            heading: "Consent to access was granted",
            body: [
              `An administrator of the wedding website${siteText} granted the service operator consent to view guest data on ${when}${until ? `, valid until ${until}` : ""}. The operator may use the data only to solve problems, and we will tell you about every access.`,
              "You can withdraw the consent at any time in the Access section.",
            ],
            link: true,
          };
    case "operator_access_revoked":
      return cs
        ? {
            subject: "Souhlas s nahlédnutím provozovatele byl odvolán",
            heading: "Souhlas s nahlédnutím byl odvolán",
            body: [
              `Správce svatebního webu${siteText} ${when} odvolal souhlas s nahlédnutím provozovatele do údajů hostů. Provozovatel k nim už nemá přístup.`,
            ],
            link: true,
          }
        : {
            subject: "Consent to operator access was withdrawn",
            heading: "Consent to access was withdrawn",
            body: [
              `An administrator of the wedding website${siteText} withdrew the consent to operator access to guest data on ${when}. The operator can no longer see them.`,
            ],
            link: true,
          };
    case "guest_data_viewed":
      return cs
        ? {
            subject: "Provozovatel nahlédl do údajů vašich hostů",
            heading: "Provozovatel nahlédl do údajů hostů",
            body: [
              `Na základě vámi uděleného souhlasu nahlédl ${when} provozovatel služby do údajů hostů svatebního webu${siteText}.`,
              ...(p.reason ? [`Důvod, který provozovatel uvedl: ${p.reason}`] : []),
              "Souhlas můžete kdykoli odvolat v části Přístup. Pokud o nahlédnutí nevíte, odvolejte ho hned a ozvěte se nám.",
            ],
            link: true,
          }
        : {
            subject: "The operator viewed your guests' data",
            heading: "The operator viewed guest data",
            body: [
              `Based on the consent you gave, the service operator viewed the guest data of the wedding website${siteText} on ${when}.`,
              ...(p.reason ? [`The reason the operator gave: ${p.reason}`] : []),
              "You can withdraw the consent at any time in the Access section. If you do not know about this access, withdraw it right away and contact us.",
            ],
            link: true,
          };
    case "site_deleted":
      return cs
        ? {
            subject: "Svatební web byl smazán",
            heading: "Svatební web byl smazán",
            body: [
              `Svatební web${siteText} byl ${when} smazán. Veřejně už není dostupný a správa je uzavřena.`,
              `Údaje se trvale smažou${until ? ` po ${until}` : " po ochranné lhůtě"}. Do té doby jde web na vaši žádost obnovit; pak už ne.`,
              "Pokud jste web nemazali vy ani druhý z vás, ozvěte se nám co nejdříve.",
            ],
            link: false,
          }
        : {
            subject: "The wedding website was deleted",
            heading: "The wedding website was deleted",
            body: [
              `The wedding website${siteText} was deleted on ${when}. It is no longer public and management is closed.`,
              `The data will be permanently erased${until ? ` after ${until}` : " after a grace period"}. Until then the website can be restored on your request; after that it cannot.`,
              "If neither you nor your partner deleted the website, contact us as soon as possible.",
            ],
            link: false,
          };
  }
}

export function renderAdminNotice(params: AdminNoticeParams): RenderedEmail {
  const { locale } = params;
  const when = formatMoment(params.at, locale);
  const until = params.until
    ? formatEventDay(params.until, locale, params.timeZone ?? "Europe/Prague")
    : null;
  const copy = copyFor(params, when, until, params.site ?? "");
  const blocks: Block[] = [
    { kind: "heading", text: copy.heading },
    ...copy.body.map((text): Block => ({ kind: "paragraph", text })),
  ];
  if (copy.link && params.loginUrl) {
    blocks.push({
      kind: "link",
      text: locale === "cs" ? "Přejít k přihlášení" : "Go to sign-in",
      href: params.loginUrl,
    });
  }
  blocks.push({
    kind: "small",
    text:
      locale === "cs"
        ? "Tuto zprávu dostáváte jako správce nebo záložní adresa svatebního webu."
        : "You are receiving this message as an administrator or the backup address of the wedding website.",
  });
  return composeEmail(locale, copy.subject, blocks, "Se vezmou");
}
