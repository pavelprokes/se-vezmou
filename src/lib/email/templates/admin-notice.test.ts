import { describe, expect, it } from "vitest";
import { htmlLang, locales } from "@/i18n/config";
import { renderAdminNotice, type AdminNoticeKind } from "./admin-notice";

const KINDS: AdminNoticeKind[] = [
  "admin_added",
  "admin_added_others",
  "admin_removed",
  "admin_removed_others",
  "backup_changed_old",
  "backup_changed",
  "operator_access_granted",
  "operator_access_revoked",
  "guest_data_viewed",
  "site_deleted",
];

const AT = new Date("2026-10-02T12:05:00Z");
const LOGIN = "https://app.se-vezmou.cz/prihlaseni";

describe.each(locales)("oznámení o změně přístupu (%s)", (locale) => {
  it("každý druh má vlastní předmět, nadpis a žádný nevyplněný zástupný znak", () => {
    const subjects = new Set<string>();
    for (const kind of KINDS) {
      const email = renderAdminNotice({
        locale,
        kind,
        at: AT,
        site: "klara-a-matej.se-vezmou.cz",
        loginUrl: LOGIN,
        until: new Date("2026-10-09T12:00:00Z"),
        reason: "Řešení importu",
      });
      subjects.add(email.subject);
      expect(email.text).not.toMatch(/undefined|NaN|\{\w+\}/);
      expect(email.html).toContain(`lang="${htmlLang[locale]}"`);
      expect(email.text).toContain("klara-a-matej.se-vezmou.cz");
    }
    expect(subjects.size).toBe(KINDS.length);
  });

  it("odkaz na přihlášení je v textu na vlastním řádku a v HTML jako odkaz, kde dává smysl", () => {
    const withLink: AdminNoticeKind[] = [
      "admin_added",
      "admin_added_others",
      "admin_removed_others",
      "backup_changed",
      "operator_access_granted",
      "operator_access_revoked",
      "guest_data_viewed",
    ];
    for (const kind of KINDS) {
      const email = renderAdminNotice({ locale, kind, at: AT, loginUrl: LOGIN });
      expect(email.text.split("\n").includes(LOGIN)).toBe(withLink.includes(kind));
      expect(email.html.includes(`href="${LOGIN}"`)).toBe(withLink.includes(kind));
    }
  });

  it("oznámení o nahlédnutí uvádí důvod provozovatele a escapuje ho v HTML", () => {
    const email = renderAdminNotice({
      locale,
      kind: "guest_data_viewed",
      at: AT,
      loginUrl: LOGIN,
      reason: "<script>alert(1)</script>",
    });
    expect(email.text).toContain("<script>alert(1)</script>");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("souhlas uvádí datum konce platnosti, smazání datum trvalého smazání, bez nich se obejdou", () => {
    const until = new Date("2026-10-09T12:00:00Z");
    const granted = renderAdminNotice({ locale, kind: "operator_access_granted", at: AT, until });
    expect(granted.text).toMatch(locale === "cs" ? /9\.\s+října\s+2026/ : /9\s+October\s+2026/);
    const deleted = renderAdminNotice({ locale, kind: "site_deleted", at: AT, until });
    expect(deleted.text).toMatch(locale === "cs" ? /9\.\s+října\s+2026/ : /9\s+October\s+2026/);
    expect(renderAdminNotice({ locale, kind: "site_deleted", at: AT }).text).not.toMatch(
      /undefined/,
    );
  });

  it("e-mailová adresa dotčené osoby se do zpráv nikdy nevkládá", () => {
    for (const kind of KINDS) {
      const email = renderAdminNotice({ locale, kind, at: AT, site: "klara-a-matej.se-vezmou.cz" });
      expect(email.text).not.toContain("@");
    }
  });
});

describe("parita jazyků", () => {
  it("cs a en mají u každého druhu stejnou strukturu (počet odstavců)", () => {
    for (const kind of KINDS) {
      const [cs, en] = locales.map((locale) =>
        renderAdminNotice({ locale, kind, at: AT, loginUrl: LOGIN, reason: "x", until: AT }),
      );
      expect(cs.text.split("\n\n").length).toBe(en.text.split("\n\n").length);
    }
  });
});
