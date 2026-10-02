import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THRESHOLDS, contrastRatio } from "./contrast";

const srcDir = join(import.meta.dirname, "..");
const css = readFileSync(join(srcDir, "app/globals.css"), "utf8");

/** Přečte barvy z bloku `@theme` v `globals.css` (zdroj pravdy o paletě). */
function themeTokens(): Record<string, string> {
  const block = /@theme\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!block) throw new Error("V globals.css chybí blok @theme");
  const tokens: Record<string, string> = {};
  for (const match of block[1].matchAll(/--color-([\w-]+):\s*([^;]+);/g)) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

const c = themeTokens();

describe("paleta značky: hodnoty ze zadání", () => {
  it("tokeny odpovídají zadání (žádná tichá změna palety)", () => {
    expect(c).toMatchObject({
      parchment: "#f7f4ed",
      warm: "#efebe1",
      ink: "#1b2a23",
      pine: "#365c4e",
      linen: "#d9e1d7",
      cinnamon: "#b66d55",
      "cinnamon-deep": "#8e503c",
      "field-border": "#7a847f",
    });
    expect(c.muted.replace(/\s/g, "")).toBe("rgba(27,42,35,0.78)");
    expect(c.hairline.replace(/\s/g, "")).toBe("rgba(54,92,78,0.22)");
  });

  it("tlačítka mají zaoblení 10 px a cíle 44 px", () => {
    expect(css).toMatch(/--radius-button:\s*10px/);
    expect(css).toMatch(/--spacing-target:\s*44px/);
  });

  it("jsou jen plné plochy: žádný přechod", () => {
    expect(css).not.toMatch(/gradient/);
  });

  it("respektuje prefers-reduced-motion", () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});

const surfaces = ["parchment", "warm", "linen"] as const;

describe("kontrast textu (WCAG 1.4.3, 4,5 : 1)", () => {
  const cases: [string, string][] = [
    ...surfaces.map((s) => ["ink", s] as [string, string]),
    ...surfaces.map((s) => ["muted", s] as [string, string]),
    ...surfaces.map((s) => ["pine", s] as [string, string]),
    ["parchment", "pine"],
    ["parchment", "ink"],
    ["cinnamon-deep", "parchment"],
    ["cinnamon-deep", "warm"],
    ["cinnamon-deep", "linen"],
  ];

  it.each(cases)("%s na %s", (fg, bg) => {
    expect(contrastRatio(c[fg], c[bg])).toBeGreaterThanOrEqual(THRESHOLDS.text);
  });
});

describe("kontrast prvků rozhraní (WCAG 1.4.11, 3 : 1)", () => {
  const cases: [string, string][] = [
    ["field-border", "parchment"],
    ["field-border", "warm"],
    ["pine", "parchment"],
    ["pine", "linen"],
    ["ink", "parchment"],
    ["ink", "linen"],
    ["ink", "warm"],
    ["cinnamon-deep", "parchment"],
  ];

  it.each(cases)("%s na %s", (fg, bg) => {
    expect(contrastRatio(c[fg], c[bg])).toBeGreaterThanOrEqual(THRESHOLDS.ui);
  });

  it("skořicová (cinnamon) stačí na velký text a ikony 3 : 1, ne na běžný text", () => {
    expect(contrastRatio(c.cinnamon, c.parchment)).toBeGreaterThanOrEqual(THRESHOLDS.large);
    expect(contrastRatio(c.cinnamon, c.parchment)).toBeLessThan(THRESHOLDS.text);
  });
});

describe("dekorativní barvy se nepoužívají jako text", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(tsx?|css)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
    });
  }

  it("žádné text-hairline, text-field-border ani text-cinnamon (jen cinnamon-deep)", () => {
    const offenders = sources(srcDir).filter((file) =>
      /\btext-(hairline|field-border|cinnamon)(?![\w-])/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("contrastRatio()", () => {
  it("černá na bílé je 21 : 1, stejné barvy 1 : 1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  it("průhledné popředí se míchá s podkladem", () => {
    const solid = contrastRatio("#1b2a23", "#f7f4ed");
    const faded = contrastRatio("rgba(27, 42, 35, 0.78)", "#f7f4ed");
    expect(faded).toBeLessThan(solid);
  });
});
