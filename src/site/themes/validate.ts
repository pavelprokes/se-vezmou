import { contrastRatio, THRESHOLDS } from "@/design/contrast";
import {
  colorRoles,
  decorativeRoles,
  hasPalette,
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
export function validatePalette(palette: Pick<Palette, "colors">): PaletteValidation {
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

  const failures = results.filter((result) => !result.ok);
  return {
    ok: errors.length === 0 && failures.length === 0,
    results,
    failures,
    decorativeOnly,
    errors,
  };
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
