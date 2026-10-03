import { describe, expect, it } from "vitest";
import { assignTones, fitNames, roman, type EuPart } from "./layout";

const OPTIONAL: EuPart[] = [
  "countdown",
  "program",
  "venue",
  "lodging",
  "dresscode",
  "story",
  "faq",
  "contact",
  "rsvp",
  "gifts",
  "gallery",
];

/** Všechny podmnožiny volitelných částí v pevném pořadí, s úvodem na začátku a patičkou na konci. */
function* layouts(): Generator<EuPart[]> {
  for (let mask = 0; mask < 1 << OPTIONAL.length; mask++) {
    yield ["hero", ...OPTIONAL.filter((_, i) => mask & (1 << i)), "footer"];
  }
}

describe("assignTones (rytmus ploch)", () => {
  it("výchozí pořadí odpovídá zadání: krém, víno, les, krém, šalvěj, noc, papír, víno", () => {
    expect(
      assignTones(["hero", "countdown", "program", "venue", "rsvp", "gifts", "gallery", "footer"]),
    ).toEqual(["light", "accent", "deep", "light", "soft", "dark", "paper", "accent"]);
  });

  it("žádné dvě sousední části nemají stejnou plochu v žádné kombinaci bloků", () => {
    for (const parts of layouts()) {
      const tones = assignTones(parts);
      expect(tones[0]).toBe("light");
      expect(tones.at(-1)).toBe("accent");
      for (let i = 1; i < tones.length; i++) {
        expect(tones[i], parts.join(",")).not.toBe(tones[i - 1]);
      }
    }
  });

  it("bez odpočtu a programu se místo konání pod úvodem přebarví", () => {
    expect(assignTones(["hero", "venue", "footer"])).toEqual(["light", "deep", "accent"]);
  });
});

describe("fitNames", () => {
  it.each([
    ["Iva", "Ota", "inline", 9, 6],
    ["Petra", "Iva", "inline", 11, 6],
    ["Kristýna", "Maximilián", "stacked", 21, 13],
    ["Anna-Marie", "Jan Křtitel", "stacked", 24, 14],
    ["Bohumila", "Přemysl", "stacked", 18, 10],
  ] as const)("%s & %s", (a, b, layout, inlineChars, stackedChars) => {
    expect(fitNames(a, b)).toEqual({ layout, inlineChars, stackedChars });
  });

  it("počítá znak s diakritikou jako jeden znak (i rozložený) a ořízne mezery", () => {
    // „Růžena“ s kroužkem jako samostatným znakem (NFD)
    expect(fitNames("  Iva ", "Ru\u030Ažena")).toMatchObject({ inlineChars: 12, stackedChars: 9 });
  });
});

describe("roman", () => {
  it.each([
    [1, "I"],
    [3, "III"],
    [4, "IV"],
    [9, "IX"],
    [12, "XII"],
  ] as const)("%i → %s", (n, expected) => {
    expect(roman(n)).toBe(expected);
  });
});
