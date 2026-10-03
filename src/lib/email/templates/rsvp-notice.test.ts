import { describe, expect, it } from "vitest";
import { htmlLang, locales } from "@/i18n/config";
import { renderRsvpNotice, type RsvpNoticeParams } from "./rsvp-notice";

const MANAGE = "https://app.se-vezmou.cz/hoste/odpovedi";

const base = (locale: RsvpNoticeParams["locale"]): RsvpNoticeParams => ({
  locale,
  partners: { a: "Klára", b: "Matěj" },
  kind: "new",
  unlisted: false,
  people: [
    { name: "Jan Novák", rows: [{ event: "Obřad", attending: true }] },
    { name: "Marie <b>Nováková</b>", rows: [{ event: "Hostina", attending: false }] },
  ],
  manageUrl: MANAGE,
});

describe.each(locales)("upozornění na odpověď (%s)", (locale) => {
  it("nové a změněné odpovědi mají jiný předmět a žádný nevyplněný zástupný znak", () => {
    const created = renderRsvpNotice(base(locale));
    const changed = renderRsvpNotice({ ...base(locale), kind: "changed" });
    expect(created.subject).not.toBe(changed.subject);
    for (const email of [created, changed]) {
      expect(email.text).not.toMatch(/undefined|NaN|\{\w+\}/);
      expect(email.html).toContain(`lang="${htmlLang[locale]}"`);
      expect(email.text).toContain("Jan Novák");
    }
  });

  it("odkaz na správu je v textu na vlastním řádku", () => {
    const email = renderRsvpNotice(base(locale));
    expect(email.text.split("\n")).toContain(MANAGE);
    expect(email.html).toContain(`href="${MANAGE}"`);
  });

  it("jména hostů se v HTML escapují", () => {
    const email = renderRsvpNotice(base(locale));
    expect(email.html).not.toContain("<b>Nováková</b>");
    expect(email.html).toContain("&lt;b&gt;");
  });

  it("odkaz ve jménu hosta se vyřízne a dlouhé jméno se zkrátí", () => {
    const email = renderRsvpNotice({
      ...base(locale),
      people: [
        { name: "Pozor: obnovte heslo na http://evil.example/x", rows: [] },
        { name: "A".repeat(200), rows: [] },
      ],
    });
    expect(email.text).not.toContain("evil.example");
    expect(email.text).not.toContain("A".repeat(81));
  });

  it("host mimo seznam má poznámku, host ze seznamu ne", () => {
    const listed = renderRsvpNotice(base(locale));
    const unlisted = renderRsvpNotice({ ...base(locale), unlisted: true });
    expect(unlisted.text.length).toBeGreaterThan(listed.text.length);
  });

  it("nenese dietu ani alergie, jen sdělení, že jsou ve správě", () => {
    const email = renderRsvpNotice(base(locale));
    expect(email.text).not.toMatch(/vegetar|celiak|laktóz|gluten/i);
    expect(email.text).toMatch(locale === "cs" ? /Dietní a\s+alergické/ : /Dietary and\s+allergy/);
  });
});
