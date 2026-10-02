import { HOSTS, pageUrl } from "./hosts";

/**
 * Pomocníci pro testy webu páru. Šablony, palety a fáze se přepínají ve vývojovém náhledu
 * `/site-preview` na hostiteli marketing (zapnutý `ENABLE_UI_CATALOG=1`, viz playwright.config.ts).
 */

export const TEMPLATES = {
  editorial: ["papir", "kamen", "pulnoc"],
  eukalyptus: ["stribrna", "hloubka", "pudr"],
  chateau: ["champagne", "slonovina", "noc"],
  modern: ["slunce", "kobalt", "limeta"],
} as const;

export type Template = keyof typeof TEMPLATES;
export type Lang = "cs" | "en";

export const VIEWPORTS = {
  mobil: { width: 375, height: 812 },
  desktop: { width: 1280, height: 800 },
} as const;

export interface PreviewOptions {
  template?: Template;
  palette?: string;
  phase?: string;
  unlocked?: boolean;
  fixture?: "eukalyptus" | "editorial";
}

export function previewUrl(lang: Lang, options: PreviewOptions = {}): string {
  const params = new URLSearchParams();
  if (options.fixture) params.set("fixture", options.fixture);
  if (options.template) params.set("template", options.template);
  if (options.palette) params.set("palette", options.palette);
  if (options.phase) params.set("phase", options.phase);
  if (options.unlocked) params.set("unlocked", "1");
  const query = params.toString();
  const path = lang === "cs" ? "/site-preview" : "/en/site-preview";
  return pageUrl(HOSTS.marketing, query ? `${path}?${query}` : path);
}

export const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
