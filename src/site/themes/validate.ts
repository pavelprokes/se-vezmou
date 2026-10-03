import { contrastRatio, THRESHOLDS } from "@/design/contrast";
import {
  colorRoles,
  decorativeRoles,
  hasPalette,
  surfaceKeys,
  templates,
  type ColorRole,
  type Palette,
  type PaletteColors,
  type TemplateKey,
} from "./palettes";

/** Druh použití dvojice barev a práh z WCAG 2.2: text 1.4.3, velký text 1.4.3, prvky UI 1.4.11. */
export type PairKind = "text" | "large" | "ui";

export interface PairSpec {
  foreground: ColorRole;
  background: ColorRole;
  kind: PairKind;
  /** K čemu se dvojice na webu používá (pro hlášení chyby správci i vývojáři). */
  use: string;
}

const surfaces = ["bg", "surface"] as const;

/** Všechny dvojice text/pozadí a prvků rozhraní, které šablony používají. */
export const PAIRS: readonly PairSpec[] = [
  ...surfaces.flatMap((background): PairSpec[] => [
    { foreground: "text", background, kind: "text", use: "běžný text" },
    { foreground: "muted", background, kind: "text", use: "doplňkový text" },
    { foreground: "accent", background, kind: "text", use: "odkazy, štítky a nadpisy" },
    { foreground: "accent2", background, kind: "text", use: "druhý akcent textu" },
    { foreground: "display", background, kind: "large", use: "velká jména a nadpisy" },
    { foreground: "border", background, kind: "ui", use: "okraje polí a oddělovače" },
    { foreground: "focus", background, kind: "ui", use: "obrys zaměření" },
    { foreground: "accent", background, kind: "ui", use: "ikony a linky akcentu" },
  ]),
  { foreground: "onAccent", background: "accent", kind: "text", use: "text na tlačítku a v pruhu" },
];

const thresholdFor: Record<PairKind, number> = {
  text: THRESHOLDS.text,
  large: THRESHOLDS.large,
  ui: THRESHOLDS.ui,
};

export interface PairResult extends PairSpec {
  ratio: number;
  required: number;
  ok: boolean;
}

export interface DecorativeColor {
  role: ColorRole;
  value: string;
  /** Poměr k pozadí jen pro informaci; dekor se nekontroluje a nesmí nést sdělení. */
  ratioToBg: number;
}

export interface PaletteValidation {
  ok: boolean;
  results: PairResult[];
  failures: PairResult[];
  /** Barvy označené jen pro dekor. */
  decorativeOnly: DecorativeColor[];
  /** Chyby struktury: chybějící role, neplatný zápis nebo dekorativní barva v roli textu. */
  errors: string[];
}

/**
 * Ověří paletu: každá dvojice text/pozadí a prvek UI musí splnit poměr (4,5 : 1 text,
 * 3 : 1 velký text a UI), dekorativní barvy se označí a nesmí se shodovat s žádnou barvou textu
 * ani rozhraní. Paleta s chybou (`ok === false`) se nesmí zveřejnit.
 */
export function validatePalette(palette: Pick<Palette, "colors" | "surfaces">): PaletteValidation {
  const colors: Partial<PaletteColors> = palette.colors;
  const errors: string[] = [];

  for (const role of colorRoles) {
    if (!colors[role]) errors.push(`chybí barva ${role}`);
  }

  const results: PairResult[] = [];
  if (errors.length === 0) {
    for (const spec of PAIRS) {
      try {
        const ratio = contrastRatio(colors[spec.foreground]!, colors[spec.background]!);
        const required = thresholdFor[spec.kind];
        results.push({ ...spec, ratio, required, ok: ratio >= required });
      } catch (error) {
        errors.push(`${spec.foreground}/${spec.background}: ${(error as Error).message}`);
      }
    }
  }

  const decorativeOnly: DecorativeColor[] = [];
  if (errors.length === 0) {
    const functional = new Set(
      colorRoles
        .filter((role) => !(decorativeRoles as readonly string[]).includes(role))
        .map((role) => colors[role]!.toLowerCase()),
    );
    for (const role of decorativeRoles) {
      const value = colors[role]!;
      decorativeOnly.push({ role, value, ratioToBg: contrastRatio(value, colors.bg!) });
      // Dekorativní barva shodná s barvou textu by se dala omylem použít jako text.
      if (functional.has(value.toLowerCase())) {
        errors.push(`dekorativní barva ${role} (${value}) se shoduje s barvou textu nebo rozhraní`);
      }
    }
  }

  if (palette.surfaces) errors.push(...validateSurfaces(palette.surfaces));

  const failures = results.filter((result) => !result.ok);
  return {
    ok: errors.length === 0 && failures.length === 0,
    results,
    failures,
    decorativeOnly,
    errors,
  };
}

/**
 * Plochy (Eukalyptus): na každé ploše text, doplňkový text a akcent 4,5 : 1, tlačítko vůči ploše a obrys
 * zaměření 3 : 1, text tlačítka 4,5 : 1. Pole má bílou výplň: text `ink` 4,5 : 1 a ohraničení `field` 3 : 1
 * na bílé; na ploše je pole vidět buď ohraničením, nebo bílou výplní (3 : 1).
 */
export function validateSurfaces(surfaces: NonNullable<Palette["surfaces"]>): string[] {
  const errors: string[] = [];
  const need = (what: string, foreground: string, background: string, required: number) => {
    const ratio = contrastRatio(foreground, background);
    if (ratio < required)
      errors.push(`${what}: ${ratio.toFixed(2)} : 1, vyžadováno ${required} : 1`);
  };
  need("pole: text na bílé", surfaces.ink, "#FFFFFF", THRESHOLDS.text);
  need("pole: ohraničení na bílé", surfaces.field, "#FFFFFF", THRESHOLDS.ui);
  for (const key of surfaceKeys) {
    const s = surfaces.tones[key];
    need(`plocha ${key}: text`, s.text, s.bg, THRESHOLDS.text);
    need(`plocha ${key}: doplňkový text`, s.muted, s.bg, THRESHOLDS.text);
    need(`plocha ${key}: akcent`, s.accent, s.bg, THRESHOLDS.text);
    need(`plocha ${key}: text tlačítka`, s.onButton, s.button, THRESHOLDS.text);
    need(`plocha ${key}: tlačítko`, s.button, s.bg, THRESHOLDS.ui);
    need(`plocha ${key}: obrys zaměření`, s.focus, s.bg, THRESHOLDS.ui);
    const field = Math.max(contrastRatio(surfaces.field, s.bg), contrastRatio("#FFFFFF", s.bg));
    if (field < THRESHOLDS.ui)
      errors.push(`plocha ${key}: pole: ${field.toFixed(2)} : 1, vyžadováno ${THRESHOLDS.ui} : 1`);
  }
  return errors;
}

/** Ověří paletu šablony podle klíčů; neznámá dvojice šablona/paleta je chyba. */
export function validateTemplatePalette(
  template: TemplateKey,
  paletteKey: string,
): PaletteValidation {
  if (!hasPalette(template, paletteKey)) {
    return {
      ok: false,
      results: [],
      failures: [],
      decorativeOnly: [],
      errors: [`šablona ${template} nemá paletu ${paletteKey}`],
    };
  }
  const palette = templates[template].palettes.find((p) => p.key === paletteKey)!;
  return validatePalette(palette);
}

/** Čitelné hlášení pro správce nebo log publikace. */
export function describeFailures(validation: PaletteValidation): string[] {
  return [
    ...validation.errors,
    ...validation.failures.map(
      (f) =>
        `${f.foreground} na ${f.background} (${f.use}): ${f.ratio.toFixed(2)} : 1, vyžadováno ${f.required} : 1`,
    ),
  ];
}
