import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/design/contrast";
import {
  colorRoles,
  decorativeRoles,
  getPalette,
  hasPalette,
  templateKeys,
  templates,
  type Palette,
} from "./palettes";
import {
  PAIRS,
  describeFailures,
  validatePalette,
  validateSurfaces,
  validateTemplatePalette,
} from "./validate";

const all = templateKeys.flatMap((template) =>
  templates[template].palettes.map((palette) => ({ template, palette })),
);

describe("šablony a palety (FR-WEB-3)", () => {
  it("má osm šablon, každou aspoň se čtyřmi předem ověřenými paletami", () => {
    expect(templateKeys).toEqual([
      "editorial",
      "eukalyptus",
      "chateau",
      "modern",
      "statek",
      "vinice",
      "louka",
      "deco",
    ]);
    for (const template of templateKeys) {
      expect(templates[template].palettes.length).toBeGreaterThanOrEqual(4);
      expect(hasPalette(template, templates[template].defaultPalette)).toBe(true);
    }
  });

  it("Eukalyptus má palety Bordó (výchozí), Stříbrná, Hloubka a Pudr, všechny s plochami", () => {
    expect(templates.eukalyptus.defaultPalette).toBe("bordo");
    expect(templates.eukalyptus.palettes.map((p) => p.name.cs)).toEqual([
      "Bordó",
      "Stříbrná",
      "Hloubka",
      "Pudr",
    ]);
  });

  it("zadané barvy Eukalyptu drží uvedený kontrast a dekorativní barvy jsou jen dekor", () => {
    const silver = getPalette("eukalyptus", "stribrna").colors;
    expect(silver.bg).toBe("#EEF3EF");
    expect(contrastRatio("#2F4B44", "#EEF3EF")).toBeGreaterThanOrEqual(8.45); // 8,5 : 1 po zaokrouhlení
    expect(contrastRatio("#7E4E3A", "#EEF3EF")).toBeGreaterThanOrEqual(6.15); // 6,2 : 1 po zaokrouhlení
    expect(silver.ornament).toBe("#8FAA9C");
    expect(silver.decor2).toBe("#D8A98F");
    expect(getPalette("eukalyptus", "hloubka").colors.bg).toBe("#223A34");
    const powder = getPalette("eukalyptus", "pudr").colors;
    expect(powder.bg).toBe("#F4F1EC");
    expect(powder.accent).toBe("#8A4A44");
  });

  it("plochy Eukalyptu drží kontrast a jen Eukalyptus plochy má", () => {
    for (const { template, palette } of all) {
      expect(palette.surfaces !== undefined).toBe(template === "eukalyptus");
      if (palette.surfaces) expect(validateSurfaces(palette.surfaces)).toEqual([]);
    }
    // Bordó podle zadání: krém, víno, les, šalvěj, noc a papír
    const bordo = getPalette("eukalyptus", "bordo").surfaces!;
    expect(bordo.tones.accent.bg).toBe("#7B2D2D");
    expect(bordo.tones.deep.bg).toBe("#1C3128");
    expect(contrastRatio(bordo.field, "#FFFFFF")).toBeGreaterThanOrEqual(4.6);
  });

  it("plocha se slabým kontrastem neprojde validací a paletu nejde zveřejnit", () => {
    const bordo = getPalette("eukalyptus", "bordo");
    const weak = {
      ...bordo,
      surfaces: {
        ...bordo.surfaces!,
        tones: {
          ...bordo.surfaces!.tones,
          soft: { ...bordo.surfaces!.tones.soft, muted: "#A0A8A2" },
        },
      },
    };
    expect(validateSurfaces(weak.surfaces).join()).toContain("plocha soft: doplňkový text");
    expect(validatePalette(weak).ok).toBe(false);
  });

  it("neznámá paleta padá na výchozí paletu šablony", () => {
    expect(getPalette("modern", "neexistuje").key).toBe(templates.modern.defaultPalette);
  });

  it("paleta má všechny role a zápis barev je platný", () => {
    for (const { palette } of all) {
      for (const role of colorRoles) expect(palette.colors[role]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("kontrast každé dvojice každé palety každé šablony (WCAG 2.2)", () => {
  for (const { template, palette } of all) {
    describe(`${template} / ${palette.key}`, () => {
      for (const pair of PAIRS) {
        const required = pair.kind === "text" ? 4.5 : 3;
        it(`${pair.foreground} na ${pair.background} (${pair.use}) ≥ ${required} : 1`, () => {
          const ratio = contrastRatio(
            palette.colors[pair.foreground],
            palette.colors[pair.background],
          );
          expect(ratio).toBeGreaterThanOrEqual(required);
        });
      }

      it("validatePalette ji uzná a dekorativní barvy označí", () => {
        const validation = validatePalette(palette);
        expect(describeFailures(validation)).toEqual([]);
        expect(validation.ok).toBe(true);
        expect(validation.decorativeOnly.map((d) => d.role)).toEqual([...decorativeRoles]);
      });

      it("dekorativní barvy nejsou v žádné dvojici textu ani prvků rozhraní", () => {
        const used = new Set(PAIRS.flatMap((p) => [p.foreground, p.background]));
        for (const role of decorativeRoles) expect(used.has(role)).toBe(false);
        // Jejich hodnota se nesmí shodovat s žádnou funkční barvou (mohla by se omylem použít jako text).
        const functional = colorRoles
          .filter((role) => !(decorativeRoles as readonly string[]).includes(role))
          .map((role) => palette.colors[role].toLowerCase());
        for (const role of decorativeRoles) {
          expect(functional).not.toContain(palette.colors[role].toLowerCase());
        }
      });
    });
  }
});

describe("validatePalette: návrh s chybou nejde zveřejnit", () => {
  const good: Palette = getPalette("eukalyptus", "stribrna");

  it("zamítne text s nedostatečným kontrastem a řekne, která dvojice selhala", () => {
    const bad = { colors: { ...good.colors, muted: "#9AAFA3" } };
    const validation = validatePalette(bad);
    expect(validation.ok).toBe(false);
    expect(validation.failures.map((f) => `${f.foreground}/${f.background}`)).toContain("muted/bg");
    expect(describeFailures(validation).join("\n")).toMatch(/muted na bg .* vyžadováno 4\.5/);
  });

  it("velký text smí mít 3 : 1, běžný text ne", () => {
    // Mezi 3 a 4,5 : 1 na obou podkladech: jako `display` projde, jako `text` ne.
    const mid = "#6F8178";
    expect(contrastRatio(mid, good.colors.bg)).toBeGreaterThan(3);
    expect(contrastRatio(mid, good.colors.surface)).toBeGreaterThan(3);
    expect(contrastRatio(mid, good.colors.bg)).toBeLessThan(4.5);
    expect(validatePalette({ colors: { ...good.colors, display: mid } }).ok).toBe(true);
    expect(validatePalette({ colors: { ...good.colors, text: mid } }).ok).toBe(false);
  });

  it("zamítne prvek rozhraní pod 3 : 1 (okraj pole, zaměření)", () => {
    expect(validatePalette({ colors: { ...good.colors, border: "#CFD9D3" } }).ok).toBe(false);
    expect(validatePalette({ colors: { ...good.colors, focus: "#CFD9D3" } }).ok).toBe(false);
  });

  it("zamítne dekorativní barvu shodnou s barvou textu", () => {
    const bad = validatePalette({ colors: { ...good.colors, decor: good.colors.accent } });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join()).toMatch(/dekorativní barva decor/);
  });

  it("zamítne chybějící roli i neplatný zápis barvy", () => {
    const missing: Partial<Palette["colors"]> = { ...good.colors };
    delete missing.muted;
    expect(validatePalette({ colors: missing as Palette["colors"] }).errors).toContain(
      "chybí barva muted",
    );
    const invalid = validatePalette({ colors: { ...good.colors, text: "tmavě zelená" } });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors.join()).toMatch(/Neznámý zápis barvy/);
  });

  it("validateTemplatePalette ověří dvojici šablona a paleta podle klíčů", () => {
    expect(validateTemplatePalette("chateau", "champagne").ok).toBe(true);
    const unknown = validateTemplatePalette("chateau", "stribrna");
    expect(unknown.ok).toBe(false);
    expect(unknown.errors[0]).toMatch(/nemá paletu/);
  });
});
