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

export const templateKeys = [
  "editorial",
  "eukalyptus",
  "chateau",
  "modern",
  "statek",
  "vinice",
  "louka",
  "deco",
] as const;
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
  /** Barevné plochy šablon s plnými plochami pro každou sekci (Eukalyptus); ostatní šablony je nemají. */
  surfaces?: PaletteSurfaces;
}

/**
 * Plochy (sémantické názvy, aby šla paleta měnit na úrovni páru): `light` úvod a místo, `paper` základ a fotky,
 * `accent` odpočet a patička, `deep` program, `soft` potvrzení účasti, `dark` dary.
 */
export const surfaceKeys = ["light", "paper", "accent", "deep", "soft", "dark"] as const;
export type SurfaceKey = (typeof surfaceKeys)[number];

/** Barvy jedné plochy: text, doplňkový text a akcent (4,5 : 1), tlačítko a obrys zaměření (3 : 1). */
export interface SurfaceColors {
  bg: string;
  text: string;
  muted: string;
  accent: string;
  button: string;
  onButton: string;
  focus: string;
}

export interface PaletteSurfaces {
  /** Vstupní pole mají vždy bílou výplň, text `ink` a ohraničení `field` (3 : 1 na bílé i na světlé ploše). */
  field: string;
  ink: string;
  tones: Record<SurfaceKey, SurfaceColors>;
}

export interface TemplateDefinition {
  key: TemplateKey;
  name: I18nText;
  defaultPalette: string;
  palettes: readonly Palette[];
}

/** Plocha z barev v pořadí pozadí, text, doplňkový text, akcent, tlačítko, text tlačítka, obrys zaměření. */
function tone(
  bg: string,
  text: string,
  muted: string,
  accent: string,
  button: string,
  onButton: string,
  focus: string,
): SurfaceColors {
  return { bg, text, muted, accent, button, onButton, focus };
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
    {
      key: "mlha",
      name: { cs: "Mlha", en: "Mist" },
      colors: {
        bg: "#F2F4F5",
        surface: "#E5E7E8",
        text: "#16191C",
        muted: "#545659",
        accent: "#16191C",
        accent2: "#2F5D73",
        onAccent: "#F2F4F5",
        display: "#16191C",
        border: "#7F8183",
        focus: "#16191C",
        ornament: "#C9D1D6",
        decor: "#DBE1E4",
        decor2: "#D3DADE",
      },
    },
  ],
};

const eukalyptus: TemplateDefinition = {
  key: "eukalyptus",
  name: { cs: "Eukalyptus", en: "Eucalyptus" },
  defaultPalette: "bordo",
  palettes: [
    {
      key: "bordo",
      name: { cs: "Bordó", en: "Burgundy" },
      colors: {
        bg: "#FBF8F2",
        surface: "#F4EEE4",
        text: "#1F2A24",
        muted: "#56605A",
        accent: "#7B2D2D",
        accent2: "#1C3128",
        onAccent: "#F4EEE4",
        display: "#7B2D2D",
        border: "#6B776F",
        focus: "#1F2A24",
        ornament: "#8FA593",
        decor: "#B7C7B9",
        decor2: "#E8C9C0",
      },
      surfaces: {
        field: "#6B776F",
        ink: "#1F2A24",
        tones: {
          light: tone("#F4EEE4", "#1F2A24", "#56605A", "#7B2D2D", "#7B2D2D", "#F4EEE4", "#7B2D2D"),
          paper: tone("#FBF8F2", "#1F2A24", "#56605A", "#7B2D2D", "#7B2D2D", "#FBF8F2", "#7B2D2D"),
          accent: tone("#7B2D2D", "#F4EEE4", "#E8C9C0", "#E8C9C0", "#F4EEE4", "#7B2D2D", "#F4EEE4"),
          deep: tone("#1C3128", "#F4EEE4", "#B7C7B9", "#B7C7B9", "#F4EEE4", "#1C3128", "#F4EEE4"),
          soft: tone("#DCE4D8", "#1F2A24", "#4C5A52", "#7B2D2D", "#7B2D2D", "#F4EEE4", "#7B2D2D"),
          dark: tone("#141E19", "#F4EEE4", "#B7C7B9", "#E8C9C0", "#F4EEE4", "#141E19", "#F4EEE4"),
        },
      },
    },
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
      surfaces: {
        field: "#5F7A6F",
        ink: "#1E2F2A",
        tones: {
          light: tone("#EEF3EF", "#1E2F2A", "#3F5750", "#2F4B44", "#2F4B44", "#EEF3EF", "#1E2F2A"),
          paper: tone("#F8FAF8", "#1E2F2A", "#3F5750", "#7E4E3A", "#2F4B44", "#F8FAF8", "#1E2F2A"),
          accent: tone("#2F4B44", "#EEF3EF", "#BFD0C5", "#F0D5C3", "#EEF3EF", "#2F4B44", "#EEF3EF"),
          deep: tone("#1E2F2A", "#EEF3EF", "#BFD0C5", "#BFD0C5", "#EEF3EF", "#1E2F2A", "#EEF3EF"),
          soft: tone("#DDE7E0", "#1E2F2A", "#3F5750", "#7E4E3A", "#2F4B44", "#EEF3EF", "#1E2F2A"),
          dark: tone("#7E4E3A", "#FBF4EE", "#F0D5C3", "#F0D5C3", "#FBF4EE", "#7E4E3A", "#FBF4EE"),
        },
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
      surfaces: {
        field: "#4F675E",
        ink: "#1E2F2A",
        tones: {
          light: tone("#223A34", "#EEF3EF", "#BFD0C5", "#F0D5C3", "#F0D5C3", "#223A34", "#EEF3EF"),
          paper: tone("#2B4740", "#EEF3EF", "#BFD0C5", "#F0D5C3", "#F0D5C3", "#223A34", "#EEF3EF"),
          accent: tone("#F0D5C3", "#1E2F2A", "#4A4038", "#7E4E3A", "#223A34", "#F0D5C3", "#1E2F2A"),
          deep: tone("#15241F", "#EEF3EF", "#BFD0C5", "#BFD0C5", "#EEF3EF", "#15241F", "#EEF3EF"),
          soft: tone("#BFD0C5", "#1E2F2A", "#33463F", "#6E3F2D", "#223A34", "#EEF3EF", "#1E2F2A"),
          dark: tone("#0F1A16", "#EEF3EF", "#BFD0C5", "#F0D5C3", "#EEF3EF", "#0F1A16", "#EEF3EF"),
        },
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
      surfaces: {
        field: "#6F7F78",
        ink: "#1E2F2A",
        tones: {
          light: tone("#F4F1EC", "#1E2F2A", "#4A5A54", "#8A4A44", "#8A4A44", "#F4F1EC", "#1E2F2A"),
          paper: tone("#FBF9F6", "#1E2F2A", "#4A5A54", "#8A4A44", "#8A4A44", "#FBF9F6", "#1E2F2A"),
          accent: tone("#8A4A44", "#F4F1EC", "#F1D9D3", "#F1D9D3", "#F4F1EC", "#8A4A44", "#F4F1EC"),
          deep: tone("#2F4B44", "#F4F1EC", "#C9D8CF", "#F1D9D3", "#F4F1EC", "#2F4B44", "#F4F1EC"),
          soft: tone("#EAD9D2", "#1E2F2A", "#4A4A44", "#7A3F3A", "#8A4A44", "#F4F1EC", "#1E2F2A"),
          dark: tone("#2A2321", "#F4F1EC", "#D2C7C2", "#F1D9D3", "#F4F1EC", "#2A2321", "#F4F1EC"),
        },
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
    {
      key: "ruze",
      name: { cs: "Růže", en: "Rose" },
      colors: {
        bg: "#FAF2F1",
        surface: "#EEE5E4",
        text: "#2E1E20",
        muted: "#67595B",
        accent: "#8C3B4A",
        accent2: "#5E5136",
        onAccent: "#FAF2F1",
        display: "#8C3B4A",
        border: "#887D7D",
        focus: "#2E1E20",
        ornament: "#D9A9AF",
        decor: "#E8CACD",
        decor2: "#E1BBC0",
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
    {
      key: "koral",
      name: { cs: "Korál", en: "Coral" },
      colors: {
        bg: "#FFF7F3",
        surface: "#F1E9E6",
        text: "#141414",
        muted: "#565452",
        accent: "#B4321E",
        accent2: "#1F4FA8",
        onAccent: "#FFF7F3",
        display: "#B4321E",
        border: "#878381",
        focus: "#141414",
        ornament: "#F6C5B8",
        decor: "#FADCD3",
        decor2: "#F8D2C7",
      },
    },
  ],
};

/*
 * Šablony z října 2026 (docs/konkurence-2026-10.md): Statek, Vinice, Louka a Deco. Palety vznikly
 * ze základních barev (pozadí, text, akcenty, dekor) dopočtením ostatních rolí a posunem barev
 * textu a rozhraní, dokud nesplní poměry WCAG 2.2; hlídá je stejný test kontrastu jako ostatní.
 */
const statek: TemplateDefinition = {
  key: "statek",
  name: { cs: "Statek", en: "Farmstead" },
  defaultPalette: "terakota",
  palettes: [
    {
      key: "terakota",
      name: { cs: "Terakota", en: "Terracotta" },
      colors: {
        bg: "#F6EEE4",
        surface: "#EBE2D8",
        text: "#3B2A20",
        muted: "#6F6157",
        accent: "#A14828",
        accent2: "#59673C",
        onAccent: "#F6EEE4",
        display: "#A14828",
        border: "#867B72",
        focus: "#3B2A20",
        ornament: "#D9B48F",
        decor: "#E6CEB5",
        decor2: "#E0C2A4",
      },
    },
    {
      key: "med",
      name: { cs: "Med", en: "Honey" },
      colors: {
        bg: "#FBF3DC",
        surface: "#EFE7D1",
        text: "#3A2E1E",
        muted: "#706553",
        accent: "#8A5210",
        accent2: "#5F6B3A",
        onAccent: "#FBF3DC",
        display: "#8A5210",
        border: "#887F6E",
        focus: "#3A2E1E",
        ornament: "#E3BE6A",
        decor: "#EED69D",
        decor2: "#E9CB86",
      },
    },
    {
      key: "len",
      name: { cs: "Len", en: "Linen" },
      colors: {
        bg: "#F4F1EA",
        surface: "#E8E5DE",
        text: "#2E2E2A",
        muted: "#656560",
        accent: "#7A5C3E",
        accent2: "#5B694C",
        onAccent: "#F4F1EA",
        display: "#7A5C3E",
        border: "#807F79",
        focus: "#2E2E2A",
        ornament: "#CFC4B0",
        decor: "#E0D8CA",
        decor2: "#D8CFBE",
      },
    },
    {
      key: "cokolada",
      name: { cs: "Čokoláda", en: "Chocolate" },
      colors: {
        bg: "#3A2A22",
        surface: "#47372F",
        text: "#F3E9DC",
        muted: "#BFB4A8",
        accent: "#E0B07A",
        accent2: "#B5C096",
        onAccent: "#3A2A22",
        display: "#E0B07A",
        border: "#968A7F",
        focus: "#F3E9DC",
        ornament: "#6B4E3D",
        decor: "#553E31",
        decor2: "#5F4536",
      },
    },
  ],
};

const vinice: TemplateDefinition = {
  key: "vinice",
  name: { cs: "Vinice", en: "Vineyard" },
  defaultPalette: "merlot",
  palettes: [
    {
      key: "merlot",
      name: { cs: "Merlot", en: "Merlot" },
      colors: {
        bg: "#F7F1EE",
        surface: "#EBE4E2",
        text: "#2B1A1F",
        muted: "#645659",
        accent: "#7B1E34",
        accent2: "#55602F",
        onAccent: "#F7F1EE",
        display: "#7B1E34",
        border: "#887E7E",
        focus: "#2B1A1F",
        ornament: "#D3AFA0",
        decor: "#E3CDC3",
        decor2: "#DCC0B3",
      },
    },
    {
      key: "fik",
      name: { cs: "Fík", en: "Fig" },
      colors: {
        bg: "#F3EEF2",
        surface: "#E7E2E6",
        text: "#2A1F2B",
        muted: "#625963",
        accent: "#6A3B63",
        accent2: "#5C6941",
        onAccent: "#F3EEF2",
        display: "#6A3B63",
        border: "#837B83",
        focus: "#2A1F2B",
        ornament: "#C9B0C4",
        decor: "#DCCCD9",
        decor2: "#D3C0D0",
      },
    },
    {
      key: "oliva",
      name: { cs: "Oliva", en: "Olive" },
      colors: {
        bg: "#F1F0E6",
        surface: "#E5E4DA",
        text: "#23271A",
        muted: "#5D5F53",
        accent: "#4E582B",
        accent2: "#8A3B46",
        onAccent: "#F1F0E6",
        display: "#4E582B",
        border: "#7C7E73",
        focus: "#23271A",
        ornament: "#C2BF95",
        decor: "#D7D5B9",
        decor2: "#CECBA9",
      },
    },
    {
      key: "ryzlink",
      name: { cs: "Ryzlink", en: "Riesling" },
      colors: {
        bg: "#FAF6E8",
        surface: "#EEEADC",
        text: "#2C2A20",
        muted: "#666358",
        accent: "#6E5D16",
        accent2: "#7B1E34",
        onAccent: "#FAF6E8",
        display: "#6E5D16",
        border: "#878479",
        focus: "#2C2A20",
        ornament: "#E0D196",
        decor: "#ECE2BB",
        decor2: "#E6DAAA",
      },
    },
  ],
};

const louka: TemplateDefinition = {
  key: "louka",
  name: { cs: "Louka", en: "Meadow" },
  defaultPalette: "maslo",
  palettes: [
    {
      key: "maslo",
      name: { cs: "Máslo", en: "Butter" },
      colors: {
        bg: "#FFF6D6",
        surface: "#F2EACB",
        text: "#2E2A1F",
        muted: "#696352",
        accent: "#7A5C00",
        accent2: "#3F64A0",
        onAccent: "#FFF6D6",
        display: "#7A5C00",
        border: "#8A8470",
        focus: "#2E2A1F",
        ornament: "#EED07A",
        decor: "#F6E1A3",
        decor2: "#F2DA91",
      },
    },
    {
      key: "levandule",
      name: { cs: "Levandule", en: "Lavender" },
      colors: {
        bg: "#F5F2FA",
        surface: "#E9E6EE",
        text: "#2A2638",
        muted: "#635F6E",
        accent: "#5E4592",
        accent2: "#516E43",
        onAccent: "#F5F2FA",
        display: "#5E4592",
        border: "#827E8A",
        focus: "#2A2638",
        ornament: "#CFC1E8",
        decor: "#E0D7F0",
        decor2: "#D9CDEC",
      },
    },
    {
      key: "mak",
      name: { cs: "Mák", en: "Poppy" },
      colors: {
        bg: "#FFF5F0",
        surface: "#F2E8E3",
        text: "#2B1C1A",
        muted: "#665956",
        accent: "#A8231C",
        accent2: "#3F6B3A",
        onAccent: "#FFF5F0",
        display: "#A8231C",
        border: "#8C807D",
        focus: "#2B1C1A",
        ornament: "#F2B5A6",
        decor: "#F8D2C7",
        decor2: "#F5C5B9",
      },
    },
    {
      key: "chrpa",
      name: { cs: "Chrpa", en: "Cornflower" },
      colors: {
        bg: "#F2F6FB",
        surface: "#E5EAEF",
        text: "#1E2A3A",
        muted: "#596370",
        accent: "#2A55A0",
        accent2: "#A04E2C",
        onAccent: "#F2F6FB",
        display: "#2A55A0",
        border: "#7D848E",
        focus: "#1E2A3A",
        ornament: "#BFD2EE",
        decor: "#D6E2F4",
        decor2: "#CCDBF1",
      },
    },
  ],
};

const deco: TemplateDefinition = {
  key: "deco",
  name: { cs: "Deco", en: "Deco" },
  defaultPalette: "pulnoc",
  palettes: [
    {
      key: "pulnoc",
      name: { cs: "Půlnoc", en: "Midnight" },
      colors: {
        bg: "#14182B",
        surface: "#242738",
        text: "#F2EDE3",
        muted: "#B4B1AF",
        accent: "#D4B572",
        accent2: "#8FB7C4",
        onAccent: "#14182B",
        display: "#D4B572",
        border: "#838287",
        focus: "#F2EDE3",
        ornament: "#3A4270",
        decor: "#292F51",
        decor2: "#30385F",
      },
    },
    {
      key: "smaragd",
      name: { cs: "Smaragd", en: "Emerald" },
      colors: {
        bg: "#0F2A24",
        surface: "#1F3831",
        text: "#F1EBDD",
        muted: "#B2B5A9",
        accent: "#D9B76E",
        accent2: "#E8A0A0",
        onAccent: "#0F2A24",
        display: "#D9B76E",
        border: "#808A80",
        focus: "#F1EBDD",
        ornament: "#2C5E50",
        decor: "#1F473C",
        decor2: "#255145",
      },
    },
    {
      key: "bordo",
      name: { cs: "Bordó", en: "Bordeaux" },
      colors: {
        bg: "#2A0F17",
        surface: "#381E25",
        text: "#F6E9E4",
        muted: "#BDACAB",
        accent: "#E2B97F",
        accent2: "#C99BB0",
        onAccent: "#2A0F17",
        display: "#E2B97F",
        border: "#907C7E",
        focus: "#F6E9E4",
        ornament: "#5C2737",
        decor: "#461C29",
        decor2: "#50212F",
      },
    },
    {
      key: "opal",
      name: { cs: "Opál", en: "Opal" },
      colors: {
        bg: "#F4F1F6",
        surface: "#E7E4EA",
        text: "#1F1C2B",
        muted: "#5B5864",
        accent: "#4B3F8F",
        accent2: "#1F6F78",
        onAccent: "#F4F1F6",
        display: "#4B3F8F",
        border: "#827E87",
        focus: "#1F1C2B",
        ornament: "#D3C8E3",
        decor: "#E2DAEC",
        decor2: "#DBD2E8",
      },
    },
  ],
};

export const templates: Record<TemplateKey, TemplateDefinition> = {
  editorial,
  eukalyptus,
  chateau,
  modern,
  statek,
  vinice,
  louka,
  deco,
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
