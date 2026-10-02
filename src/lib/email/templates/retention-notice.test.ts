import { describe, expect, it } from "vitest";
import { locales, type Locale } from "@/i18n/config";
import { NBSP, findTypoViolations, typo } from "@/i18n/typo";
import {
  renderDeletionNotice,
  renderRetentionNotice,
  type DeletionNoticeKind,
  type RenderedEmail,
  type RetentionNoticeKind,
} from "./index";

const LOGIN = "https://app.se-vezmou.cz/prihlaseni";
const SITE = "klara-a-matej.se-vezmou.cz";
// půlnoc 12. července 2027 v Praze (letní čas): 11. 7. 22:00 UTC
const EVENT = new Date("2027-07-11T22:00:00Z");

const retentionKinds: RetentionNoticeKind[] = ["site_expiry", "health_purge", "guest_purge"];
const deletionKinds: DeletionNoticeKind[] = ["health_purge", "guest_purge", "site_purge"];

function all(locale: Locale): Record<string, RenderedEmail> {
  const out: Record<string, RenderedEmail> = {};
  for (const kind of retentionKinds) {
    for (const stage of ["first", "final"] as const) {
      out[`notice:${kind}:${stage}`] = renderRetentionNotice({
        locale,
        kind,
        stage,
        eventAt: EVENT,
        timeZone: "Europe/Prague",
        site: SITE,
        loginUrl: LOGIN,
      });
    }
  }
  for (const kind of deletionKinds) {
    out[`deleted:${kind}`] = renderDeletionNotice({
      locale,
      kind,
      at: EVENT,
      timeZone: "Europe/Prague",
      site: SITE,
      loginUrl: LOGIN,
    });
  }
  return out;
}

const withoutUrls = (text: string) => text.replace(/https?:\/\/\S+/g, "");

describe.each(locales)("e-maily o retenci a mazání (%s)", (locale) => {
  const emails = all(locale);

  it.each(Object.entries(emails))("%s: předmět, text i HTML jsou vyplněné", (_name, email) => {
    expect(email.subject.length).toBeGreaterThan(10);
    expect(email.text.length).toBeGreaterThan(100);
    expect(email.html).toContain("<!doctype html>");
    expect(email.html).toContain(`lang="${locale === "cs" ? "cs" : "en-GB"}"`);
    expect(email.text).not.toContain("undefined");
    expect(email.html).not.toContain("undefined");
  });

  it.each(Object.entries(emails))("%s: typografie a žádné rovné uvozovky", (_name, email) => {
    for (const text of [email.subject, withoutUrls(email.text)]) {
      expect(typo(text, locale)).toBe(text);
      expect(findTypoViolations(text, locale)).toEqual([]);
    }
    expect(email.text).not.toMatch(/["']/);
  });

  it.each(Object.entries(emails))(
    "%s: bez sledování a cizích zdrojů, jediný odkaz je přihlášení",
    (_name, email) => {
      expect(email.html).not.toMatch(/<img|<script|<link|<iframe|url\(|src=/i);
      const hrefs = [...email.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      for (const href of hrefs) expect(href).toBe(LOGIN);
    },
  );

  it("datum události je v pásmu svatby, ne v pásmu serveru (půlnoc v Praze je ještě 11. července v New Yorku)", () => {
    const prague = renderRetentionNotice({
      locale,
      kind: "health_purge",
      stage: "first",
      eventAt: EVENT,
      timeZone: "Europe/Prague",
      loginUrl: LOGIN,
    });
    const newYork = renderRetentionNotice({
      locale,
      kind: "health_purge",
      stage: "first",
      eventAt: EVENT,
      timeZone: "America/New_York",
      loginUrl: LOGIN,
    });
    expect(prague.subject).toContain(
      locale === "cs" ? `12.${NBSP}července 2027` : `12${NBSP}July 2027`,
    );
    expect(newYork.subject).toContain(
      locale === "cs" ? `11.${NBSP}července 2027` : `11${NBSP}July 2027`,
    );
  });

  it("závěrečné upozornění je připomenutí s vlastním úvodem, první ne", () => {
    const first = emails["notice:guest_purge:first"];
    const final = emails["notice:guest_purge:final"];
    expect(final.subject.startsWith(locale === "cs" ? "Připomenutí: " : "Reminder: ")).toBe(true);
    expect(first.subject).not.toMatch(/Připomenutí|Reminder/);
    expect(final.text).toMatch(locale === "cs" ? /naposledy/ : /last time/);
    expect(first.text).not.toMatch(locale === "cs" ? /naposledy/ : /last time/);
  });

  it("upozornění nabízí export hostů, odpovědí a fotografií po přihlášení a neslibuje veřejný odkaz", () => {
    const guests = emails["notice:guest_purge:first"];
    expect(guests.text).toMatch(
      locale === "cs" ? /export hostů a\sodpovědí/ : /export of guests and replies/,
    );
    expect(guests.text).toMatch(locale === "cs" ? /fotografií/ : /photos/);
    expect(guests.text).toContain(LOGIN);
    expect(guests.text).toMatch(locale === "cs" ? /Po přihlášení/ : /After signing in/);
    // dietní údaje: exportují se jen zdravotní údaje výslovně u druhu health_purge
    expect(emails["notice:health_purge:first"].text).toMatch(
      locale === "cs" ? /dietních údajů/ : /dietary details/,
    );
  });

  it("zprávy neobsahují osobní údaje hostů ani jména (jen datum, adresu webu a odkaz)", () => {
    for (const email of Object.values(emails)) {
      expect(`${email.subject}${email.text}${email.html}`).not.toMatch(/Novák|Klára|Matěj|@/);
    }
  });

  it("zpráva o smazání webu nemá odkaz na přihlášení a slibuje, že se adresa nepřidělí", () => {
    const purge = emails["deleted:site_purge"];
    expect(purge.html).not.toMatch(/<a /);
    expect(purge.text).not.toContain(LOGIN);
    expect(purge.text).toMatch(
      locale === "cs" ? /nikomu dalšímu nepřidělí/ : /not be given to anyone else/,
    );
  });

  it("zprávy o smazání údajů hostů mají odkaz a říkají, že smazání je nevratné", () => {
    for (const kind of ["health_purge", "guest_purge"] as const) {
      const email = emails[`deleted:${kind}`];
      expect(email.text).toContain(LOGIN);
      expect(email.text).toMatch(locale === "cs" ? /nevratně/ : /irreversibly/);
    }
  });

  it("bez adresy webu se zpráva obejde bez ní", () => {
    const email = renderRetentionNotice({
      locale,
      kind: "site_expiry",
      stage: "first",
      eventAt: EVENT,
      timeZone: "Europe/Prague",
      loginUrl: LOGIN,
    });
    expect(email.text).not.toContain("undefined");
    expect(email.text).not.toContain("klara-a-matej");
  });

  it("dosazené hodnoty se escapují v HTML", () => {
    const email = renderRetentionNotice({
      locale,
      kind: "site_expiry",
      stage: "first",
      eventAt: EVENT,
      timeZone: "Europe/Prague",
      site: '<script>alert("x")</script>.se-vezmou.cz',
      loginUrl: 'https://app.se-vezmou.cz/?a="><script>1</script>',
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});

describe("parita jazyků", () => {
  it("cs a en mají stejnou strukturu a různé předměty", () => {
    const cs = all("cs");
    const en = all("en");
    for (const name of Object.keys(cs)) {
      const shape = (email: RenderedEmail) => ({
        paragraphs: (email.html.match(/<p /g) ?? []).length,
        headings: (email.html.match(/<h1 /g) ?? []).length,
        links: (email.html.match(/<a /g) ?? []).length,
        lines: email.text.split("\n").length,
      });
      expect(shape(cs[name]), name).toEqual(shape(en[name]));
      expect(cs[name].subject, name).not.toBe(en[name].subject);
    }
  });

  it("předměty se mezi druhy a fázemi liší", () => {
    const subjects = Object.values(all("cs")).map((email) => email.subject);
    expect(new Set(subjects).size).toBe(subjects.length);
  });
});
