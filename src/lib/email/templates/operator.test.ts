import { describe, expect, it } from "vitest";
import { findTypoViolations, typo } from "@/i18n/typo";
import { renderOperatorCode, renderOperatorNotice, renderOperatorSitePublished } from "./operator";

const AT = new Date("2026-10-02T12:05:00Z");

describe("e-maily operátorům", () => {
  it("kód je na samostatném řádku textové verze a platnost je slovy", () => {
    const mail = renderOperatorCode({ code: "048213", ttlSeconds: 600 });
    expect(mail.subject).toBe("Přihlašovací kód do provozní administrace");
    expect(mail.text).toMatch(/^048213$/m);
    expect(mail.text).toMatch(/10\sminut/);
    expect(mail.html).toContain("048213");
    expect(mail.html).toContain('lang="cs"');
  });

  it("oznámení o přihlášení, záložním kódu a nové sadě kódů", () => {
    const login = renderOperatorNotice({ event: "login", at: AT });
    expect(login.text).toContain("14:05");
    const backup = renderOperatorNotice({ event: "backup_code", at: AT, remaining: 4 });
    expect(backup.subject).toBe("Použit záložní kód");
    expect(backup.text).toMatch(/Zbývá\s4/);
    expect(renderOperatorNotice({ event: "backup_codes_regenerated", at: AT }).subject).toBe(
      "Vygenerována nová sada záložních kódů",
    );
  });

  it("texty procházejí typografií (jsou idempotentní, bez jednopísmenných předložek na konci řádku)", () => {
    for (const mail of [
      renderOperatorCode({ code: "048213", ttlSeconds: 600 }),
      renderOperatorNotice({ event: "login", at: AT }),
      renderOperatorNotice({ event: "backup_code", at: AT, remaining: 1 }),
      renderOperatorNotice({ event: "backup_codes_regenerated", at: AT }),
    ]) {
      expect(typo(mail.subject, "cs")).toBe(mail.subject);
      expect(findTypoViolations(mail.text, "cs")).toEqual([]);
    }
  });

  it("e-mail ani kód se nedostanou do předmětu", () => {
    const mail = renderOperatorCode({ code: "048213", ttlSeconds: 600 });
    expect(mail.subject).not.toContain("048213");
  });
});

describe("upozornění o zveřejnění webu", () => {
  const mail = renderOperatorSitePublished({
    siteUrl: "https://klara-a-matej.se-vezmou.cz/",
    slug: "klara-a-matej",
    template: "statek",
    locale: "cs",
    at: AT,
  });

  it("nese adresu, šablonu a čas, odkaz je na vlastním řádku", () => {
    expect(mail.subject).toBe("Nový web: klara-a-matej");
    expect(mail.text).toContain("14:05");
    expect(mail.text).toContain("statek");
    expect(mail.text.split("\n")).toContain("https://klara-a-matej.se-vezmou.cz/");
    expect(mail.html).toContain('href="https://klara-a-matej.se-vezmou.cz/"');
    expect(mail.text).not.toMatch(/undefined|NaN|\{\w+\}/);
  });

  it("prochází typografií", () => {
    expect(typo(mail.subject, "cs")).toBe(mail.subject);
    expect(findTypoViolations(mail.text, "cs")).toEqual([]);
  });
});
