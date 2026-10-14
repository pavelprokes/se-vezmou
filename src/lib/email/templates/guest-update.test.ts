import { describe, expect, it } from "vitest";
import { htmlLang, locales } from "@/i18n/config";
import { renderGuestUpdate, type GuestUpdateParams } from "./guest-update";

const SITE = "https://klara-a-matej.se-vezmou.cz/";
const UNSUBSCRIBE =
  "https://klara-a-matej.se-vezmou.cz/upozorneni?t=0123456789abcdef0123456789abcdef0123";

const base = (locale: GuestUpdateParams["locale"]): GuestUpdateParams => ({
  locale,
  partners: { a: "Klára", b: "Matěj" },
  text: "Obřad začíná o hodinu dřív, ve 13:00.\n\nZbytek programu <b>platí</b>.",
  siteUrl: SITE,
  unsubscribeUrl: UNSUBSCRIBE,
});

describe.each(locales)("upozornění hostům na změnu (%s)", (locale) => {
  it("nese text páru po odstavcích, odkaz na web a na odhlášení na vlastních řádcích", () => {
    const email = renderGuestUpdate(base(locale));
    expect(email.html).toContain(`lang="${htmlLang[locale]}"`);
    expect(email.subject).toContain("Klára");
    const lines = email.text.split("\n");
    expect(lines).toContain(SITE);
    expect(lines).toContain(UNSUBSCRIBE);
    expect(email.text).toMatch(/Obřad začíná o\s+hodinu dřív/);
    expect(email.text).not.toMatch(/undefined|NaN|\{\w+\}/);
  });

  it("HTML z textu páru se escapuje", () => {
    const email = renderGuestUpdate(base(locale));
    expect(email.html).not.toContain("<b>platí</b>");
    expect(email.html).toContain("&lt;b&gt;platí&lt;/b&gt;");
  });
});
