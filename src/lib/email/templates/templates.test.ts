import { describe, expect, it } from "vitest";
import { locales, type Locale } from "@/i18n/config";
import { NBSP, findTypoViolations, typo } from "@/i18n/typo";
import { renderBackupLoginNotice, renderLoginCode, type RenderedEmail } from "./index";

const LINK = "https://app.se-vezmou.cz/prihlaseni/odkaz?t=abc_DEF-123";
const AT = new Date("2026-10-02T12:05:00Z"); // 14:05 pražského času

function allEmails(locale: Locale): Record<string, RenderedEmail> {
  return {
    loginCode: renderLoginCode({ locale, code: "048213", link: LINK, ttlSeconds: 600 }),
    pinLogin: renderBackupLoginNotice({
      locale,
      event: "pin_login",
      at: AT,
      site: "klara-a-matej.se-vezmou.cz",
      loginUrl: LINK,
    }),
    pinLoginNoSite: renderBackupLoginNotice({ locale, event: "pin_login", at: AT, loginUrl: LINK }),
    pinLocked: renderBackupLoginNotice({
      locale,
      event: "pin_locked",
      at: AT,
      site: "klara-a-matej.se-vezmou.cz",
      pauseSeconds: 1800,
      loginUrl: LINK,
    }),
    pinChanged: renderBackupLoginNotice({
      locale,
      event: "pin_changed",
      pinRole: "guest",
      at: AT,
      site: "klara-a-matej.se-vezmou.cz",
      loginUrl: LINK,
    }),
  };
}

/** Text bez adres (v nich jsou tečky a čísla, na která typografická pravidla nemíří). */
const withoutUrls = (text: string) => text.replace(/https?:\/\/\S+/g, "");

describe.each(locales)("e-mailové šablony (%s)", (locale) => {
  const emails = allEmails(locale);

  it.each(Object.entries(emails))("%s: předmět, text i HTML jsou vyplněné", (_name, email) => {
    expect(email.subject.length).toBeGreaterThan(5);
    expect(email.text.length).toBeGreaterThan(50);
    expect(email.html).toContain("<!doctype html>");
    expect(email.html).toContain(`lang="${locale === "cs" ? "cs" : "en-GB"}"`);
  });

  it.each(Object.entries(emails))("%s: texty jsou už typograficky upravené", (_name, email) => {
    for (const text of [email.subject, withoutUrls(email.text)]) {
      expect(typo(text, locale)).toBe(text);
      expect(findTypoViolations(text, locale)).toEqual([]);
    }
  });

  it.each(Object.entries(emails))(
    "%s: bez rovných uvozovek, sledování a cizích zdrojů",
    (_name, email) => {
      expect(email.text).not.toMatch(/["']/);
      expect(email.html).not.toMatch(/<img|<script|<link|<iframe|url\(|src=/i);
      // jediné odkazy vedou na naši adresu
      const hrefs = [...email.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      for (const href of hrefs) expect(href).toBe(LINK);
    },
  );

  it("přihlašovací kód je na vlastním řádku v textu (jde vložit ze schránky) a v HTML", () => {
    const { text, html } = emails.loginCode;
    expect(text.split("\n")).toContain("048213");
    expect(html).toContain(">048213<");
  });

  it("odkaz je v textové verzi na vlastním řádku a v HTML jako odkaz s popisem", () => {
    const { text, html } = emails.loginCode;
    expect(text.split("\n")).toContain(LINK);
    expect(html).toMatch(/<a href="[^"]+"[^>]*>[^<]{5,}<\/a>/);
  });

  it("platnost kódu je uvedena s nezlomitelnou mezerou (10 minut)", () => {
    expect(emails.loginCode.text).toContain(`10${NBSP}${locale === "cs" ? "minut" : "minutes"}`);
  });

  it("oznámení o přihlášení nese adresu webu, datum v pražském čase a odkaz", () => {
    const { text } = emails.pinLogin;
    expect(text).toContain("klara-a-matej.se-vezmou.cz");
    expect(text).toContain("14:05");
    expect(text).toContain(LINK);
  });

  it("oznámení bez adresy webu se obejde bez ní", () => {
    expect(emails.pinLoginNoSite.text).not.toContain("undefined");
    expect(emails.pinLoginNoSite.text).not.toContain("klara-a-matej");
  });

  it("pozastavení PINu uvádí délku pauzy", () => {
    expect(emails.pinLocked.text).toContain(`30${NBSP}${locale === "cs" ? "minut" : "minutes"}`);
  });

  it("změna PINu rozlišuje PIN hostů", () => {
    expect(emails.pinChanged.text).toMatch(locale === "cs" ? /PIN pro hosty/ : /guest PIN/);
  });

  it("předměty se mezi typy oznámení liší", () => {
    const subjects = Object.values(emails).map((email) => email.subject);
    expect(new Set(subjects).size).toBe(4); // pinLogin a pinLoginNoSite sdílejí předmět
  });
});

describe("parita jazyků", () => {
  it("cs a en mají stejnou strukturu (počet odstavců a odkazů) u každé šablony", () => {
    const cs = allEmails("cs");
    const en = allEmails("en");
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
});

describe("bezpečnost HTML", () => {
  it("dosazené hodnoty se escapují", () => {
    const email = renderBackupLoginNotice({
      locale: "cs",
      event: "pin_login",
      at: AT,
      site: '<script>alert("x")</script>.se-vezmou.cz',
      loginUrl: 'https://app.se-vezmou.cz/?a="><script>1</script>',
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).not.toContain('"><script>');
  });
});
