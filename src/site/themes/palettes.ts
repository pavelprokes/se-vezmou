import type { I18nText } from "../i18n-text";

/**
 * Šablony a jejich předem ověřené palety (FR-WEB-3). Šablona mění jen tokeny, typografii a kompozici
 * nad společnými bloky. Hodnoty hlídá `validatePalette()` (kontrast WCAG 2.2) a test kontrastu
 * všech palet; paleta s chybou nejde zveřejnit.
 *
 * Role barev:
 * - `text`, `muted`, `accent`, `accent2`, `onAccent` jsou barvy textu (4,5 : 1),
 * - `display` je jen pro velký text (3 : 1), např. tenké řezy jmen,
 * - `border` a `focus` jsou prvky rozhraní (3 : 1),
 * - `ornament`, `decor`, `decor2` jsou JEN dekor (linky, listy, ornamenty). Nesmí nést text
 *   ani sdělení; validace je označí jako „dekorativní“ a nekontroluje.
 */

export const templateKeys = ["editorial", "eukalyptus", "chateau", "modern"] as const;
export type TemplateKey = (typeof templateKeys)[number];

export const colorRoles = [
  "bg",
  "surface",
  "text",
  "muted",
  "accent",
  "accent2",
  "onAccent",
  "display",
  "border",
  "focus",
  "ornament",
  "decor",
  "decor2",
] as const;
export type ColorRole = (typeof colorRoles)[number];
export type PaletteColors = Record<ColorRole, string>;

/** Role, které smějí být jen dekorací a nikdy nenesou text ani prvek rozhraní. */
export const decorativeRoles = ["ornament", "decor", "decor2"] as const satisfies ColorRole[];

export interface Palette {
  key: string;
  name: I18nText;
  colors: PaletteColors;
}

export interface TemplateDefinition {
  key: TemplateKey;
  name: I18nText;
  defaultPalette: string;
  palettes: readonly Palette[];
}

const editorial: TemplateDefinition = {
  key: "editorial",
  name: { cs: "Editorial", en: "Editorial" },
  defaultPalette: "papir",
  palettes: [
    {
      key: "papir",
      name: { cs: "Papír", en: "Paper" },
      colors: {
        bg: "#FBFAF7",
        surface: "#F1EEE8",
        text: "#17171A",
        muted: "#4D4A45",
        accent: "#17171A",
        accent2: "#9A3B22",
        onAccent: "#FBFAF7",
        display: "#2B2B2E",
        border: "#75716A",
        focus: "#17171A",
        ornament: "#BDB8AE",
        decor: "#D9D3C7",
        decor2: "#CFC8BA",
      },
    },
    {
      key: "kamen",
      name: { cs: "Kámen", en: "Stone" },
      colors: {
        bg: "#ECE8E1",
        surface: "#E0DBD2",
        text: "#1D2024",
        muted: "#464A50",
        accent: "#2B4660",
        accent2: "#7A3E2E",
        onAccent: "#F7F5F0",
        display: "#2B4660",
        border: "#6E7378",
        focus: "#1D2024",
        ornament: "#A9A398",
        decor: "#C4BEB2",
        decor2: "#B5AFA3",
      },
    },
    {
      key: "pulnoc",
      name: { cs: "Půlnoc", en: "Midnight" },
      colors: {
        bg: "#15171A",
        surface: "#1F2226",
        text: "#F3F0EA",
        muted: "#C4C0B8",
        accent: "#E9C7A0",
        accent2: "#F0B9A0",
        onAccent: "#15171A",
        display: "#F3F0EA",
        border: "#8A8F96",
        focus: "#F3F0EA",
        ornament: "#4A4F57",
        decor: "#33373D",
        decor2: "#3E434A",
      },
    },
  ],
};

const eukalyptus: TemplateDefinition = {
  key: "eukalyptus",
  name: { cs: "Eukalyptus", en: "Eucalyptus" },
  defaultPalette: "stribrna",
  palettes: [
    {
      key: "stribrna",
      name: { cs: "Stříbrná", en: "Silver" },
      colors: {
        bg: "#EEF3EF",
        surface: "#DDE7E0",
        text: "#1E2F2A",
        muted: "#3F5750",
        accent: "#2F4B44",
        accent2: "#7E4E3A",
        onAccent: "#EEF3EF",
        display: "#2F4B44",
        border: "#5F7A6F",
        focus: "#1E2F2A",
        ornament: "#8FAA9C",
        decor: "#BFD0C5",
        decor2: "#D8A98F",
      },
    },
    {
      key: "hloubka",
      name: { cs: "Hloubka", en: "Depth" },
      colors: {
        bg: "#223A34",
        surface: "#2B4740",
        text: "#EEF3EF",
        muted: "#BFD0C5",
        accent: "#BFD0C5",
        accent2: "#F0D5C3",
        onAccent: "#1E2F2A",
        display: "#EEF3EF",
        border: "#9DB5A8",
        focus: "#EEF3EF",
        ornament: "#8FAA9C",
        decor: "#3A5A51",
        decor2: "#D8A98F",
      },
    },
    {
      key: "pudr",
      name: { cs: "Pudr", en: "Powder" },
      colors: {
        bg: "#F4F1EC",
        surface: "#EBE5DC",
        text: "#1E2F2A",
        muted: "#4A5A54",
        accent: "#8A4A44",
        accent2: "#2F4B44",
        onAccent: "#F4F1EC",
        display: "#8A4A44",
        border: "#6F7F78",
        focus: "#1E2F2A",
        ornament: "#8FAA9C",
        decor: "#BFD0C5",
        decor2: "#D8A98F",
      },
    },
  ],
};

const chateau: TemplateDefinition = {
  key: "chateau",
  name: { cs: "Chateau", en: "Chateau" },
  defaultPalette: "champagne",
  palettes: [
    {
      key: "champagne",
      name: { cs: "Champagne", en: "Champagne" },
      colors: {
        bg: "#FBF6EC",
        surface: "#F2E9D8",
        text: "#2A2320",
        muted: "#5A4E46",
        accent: "#6E2A35",
        accent2: "#5B4A2E",
        onAccent: "#FBF6EC",
        display: "#6E2A35",
        border: "#7C6E62",
        focus: "#2A2320",
        ornament: "#B08A3E",
        decor: "#D9C38F",
        decor2: "#E6D7B0",
      },
    },
    {
      key: "slonovina",
      name: { cs: "Slonová kost", en: "Ivory" },
      colors: {
        bg: "#F7F3EA",
        surface: "#ECE6D8",
        text: "#1F2733",
        muted: "#4B5563",
        accent: "#26364F",
        accent2: "#6B4F1D",
        onAccent: "#F7F3EA",
        display: "#26364F",
        border: "#6B7280",
        focus: "#1F2733",
        ornament: "#A98532",
        decor: "#D4C18C",
        decor2: "#E3D5AE",
      },
    },
    {
      key: "noc",
      name: { cs: "Noc", en: "Night" },
      colors: {
        bg: "#1B2030",
        surface: "#252B3E",
        text: "#F5EFE0",
        muted: "#CFC8B6",
        accent: "#E3CFA0",
        accent2: "#EBD9B0",
        onAccent: "#1B2030",
        display: "#E3CFA0",
        border: "#8F95A8",
        focus: "#F5EFE0",
        ornament: "#C9A45C",
        decor: "#3A4260",
        decor2: "#4A5273",
      },
    },
  ],
};

const modern: TemplateDefinition = {
  key: "modern",
  name: { cs: "Modern", en: "Modern" },
  defaultPalette: "slunce",
  palettes: [
    {
      key: "slunce",
      name: { cs: "Slunce", en: "Sun" },
      colors: {
        bg: "#FAF9F6",
        surface: "#F0EDE6",
        text: "#0E0E10",
        muted: "#4A4A4F",
        accent: "#C42B0A",
        accent2: "#0E0E10",
        onAccent: "#FFFFFF",
        display: "#0E0E10",
        border: "#76767B",
        focus: "#0E0E10",
        ornament: "#F2B8A8",
        decor: "#E6DFD2",
        decor2: "#F5D0C5",
      },
    },
    {
      key: "kobalt",
      name: { cs: "Kobalt", en: "Cobalt" },
      colors: {
        bg: "#F4F6FC",
        surface: "#E6EAF7",
        text: "#0B1020",
        muted: "#404764",
        accent: "#2535C8",
        accent2: "#7A1F4B",
        onAccent: "#FFFFFF",
        display: "#2535C8",
        border: "#6C74A0",
        focus: "#0B1020",
        ornament: "#AEB6EE",
        decor: "#D3D9F3",
        decor2: "#C2C9EE",
      },
    },
    {
      key: "limeta",
      name: { cs: "Limeta", en: "Lime" },
      colors: {
        bg: "#0D0F12",
        surface: "#171B20",
        text: "#F5F7F2",
        muted: "#C3C8C0",
        accent: "#C6F135",
        accent2: "#9FE0FF",
        onAccent: "#0D0F12",
        display: "#C6F135",
        border: "#868C94",
        focus: "#F5F7F2",
        ornament: "#3B4A1A",
        decor: "#242A31",
        decor2: "#2E353D",
      },
    },
  ],
};

export const templates: Record<TemplateKey, TemplateDefinition> = {
  editorial,
  eukalyptus,
  chateau,
  modern,
};

export function isTemplateKey(value: string): value is TemplateKey {
  return (templateKeys as readonly string[]).includes(value);
}

/** Paleta šablony podle klíče; neznámý klíč padá na výchozí paletu šablony (web se nikdy nerozbije). */
export function getPalette(template: TemplateKey, paletteKey: string): Palette {
  const definition = templates[template];
  return (
    definition.palettes.find((p) => p.key === paletteKey) ??
    definition.palettes.find((p) => p.key === definition.defaultPalette) ??
    definition.palettes[0]
  );
}

export function hasPalette(template: TemplateKey, paletteKey: string): boolean {
  return templates[template].palettes.some((p) => p.key === paletteKey);
}
