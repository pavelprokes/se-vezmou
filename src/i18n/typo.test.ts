import { describe, expect, it } from "vitest";
import { NBSP, findTypoViolations, typo } from "./typo";

const n = (text: string) => text.replaceAll("~", NBSP);

describe("typo() česky", () => {
  it.each([
    ["v kolik", "v~kolik"],
    ["na svatbu a ubytování", "na svatbu a~ubytování"],
    ["V pátek jedeme k babičce s dětmi", "V~pátek jedeme k~babičce s~dětmi"],
    ["Klára a Matěj", "Klára a~Matěj"],
    ["o u z i", "o~u~z~i"],
  ])("jednopísmenné předložky a spojky: %s", (input, expected) => {
    expect(typo(input, "cs")).toBe(n(expected));
  });

  it("nesahá na jednopísmenné části delších slov", () => {
    expect(typo("sova a kos", "cs")).toBe(n("sova a~kos"));
    expect(typo("domov", "cs")).toBe("domov");
  });

  it.each([
    ["990 Kč", "990~Kč"],
    ["60 hostů", "60~hostů"],
    ["do 3 dnů", "do 3~dnů"],
    ["25 °C", "25~°C"],
    ["50 %", "50~%"],
    ["12 000 Kč", "12~000~Kč"],
    ["12 000", "12~000"],
  ])("číslo a jednotka, tisíce: %s", (input, expected) => {
    expect(typo(input, "cs")).toBe(n(expected));
  });

  it("nespojuje číslo s běžným slovem", () => {
    expect(typo("5 slunečních dnů", "cs")).toBe("5 slunečních dnů");
    expect(typo("60 hostinských", "cs")).toBe("60 hostinských");
  });

  it.each([
    ["1. 10. 2026", "1.~10.~2026"],
    ["Svatba je 12. 9. 2026 v poledne", "Svatba je 12.~9.~2026 v~poledne"],
    ["do 1. října", "do 1.~října"],
    ["1. 10.", "1.~10."],
  ])("datum: %s", (input, expected) => {
    expect(typo(input, "cs")).toBe(n(expected));
  });

  it("nechává čas a desetinnou čárku beze změny", () => {
    expect(typo("14:00", "cs")).toBe("14:00");
    expect(typo("2,5", "cs")).toBe("2,5");
    expect(typo("2,5 km", "cs")).toBe(n("2,5~km"));
  });

  it("tři tečky jsou jeden znak", () => {
    expect(typo("Počkejte...", "cs")).toBe("Počkejte…");
    // Čtyři a více teček se nemění.
    expect(typo("Počkejte....", "cs")).toBe("Počkejte....");
  });

  it("myšlenková pauza je pomlčka, spojovník ve slově zůstává", () => {
    expect(typo("obřad - hostina", "cs")).toBe(n("obřad~– hostina"));
    expect(typo("česko-slovenský", "cs")).toBe("česko-slovenský");
  });

  it("nehádá uvozovky", () => {
    expect(typo('říká "ahoj"', "cs")).toBe('říká "ahoj"');
    expect(typo("říká „ahoj“", "cs")).toBe("říká „ahoj“");
  });

  it("je idempotentní", () => {
    const samples = [
      "v kolik a na svatbu 990 Kč, 60 hostů, 1. 10. 2026 ve 14:00, 2,5 a 12 000...",
      "obřad - hostina k večeři s přáteli",
      "",
    ];
    for (const sample of samples) {
      const once = typo(sample, "cs");
      expect(typo(once, "cs")).toBe(once);
    }
  });

  it("zachová prázdný řetězec a text bez pravidel", () => {
    expect(typo("", "cs")).toBe("");
    expect(typo("Dobrý den", "cs")).toBe("Dobrý den");
  });
});

describe("typo() anglicky", () => {
  it("nezlomitelná mezera mezi číslem a jednotkou", () => {
    expect(typo("60 guests for 3 days", "en")).toBe(n("60~guests for 3~days"));
  });

  it("nepoužívá české předložky", () => {
    expect(typo("a day in the sun", "en")).toBe("a day in the sun");
  });

  it("třítečka a pomlčka", () => {
    expect(typo("Wait... then go - quickly", "en")).toBe(n("Wait… then go~– quickly"));
  });

  it("datum s názvem měsíce", () => {
    expect(typo("on 1 October 2026", "en")).toBe(n("on 1~October 2026"));
  });

  it("je idempotentní", () => {
    const once = typo("60 guests... 1 October 2026 - 14:00", "en");
    expect(typo(once, "en")).toBe(once);
  });
});

describe("findTypoViolations()", () => {
  it("hlásí rovné uvozovky a apostrof", () => {
    expect(findTypoViolations('říká "ahoj"', "cs")).toContain('rovná uvozovka (")');
    expect(findTypoViolations("it's", "en")).toContain("rovný apostrof (')");
  });

  it("správný text nemá porušení", () => {
    expect(findTypoViolations("Klára a Matěj, 60 hostů, 1. 10. 2026 ve 14:00…", "cs")).toEqual([]);
    expect(findTypoViolations("It’s “fine”, 60 guests", "en")).toEqual([]);
  });
});
