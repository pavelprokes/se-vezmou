/**
 * `llms.txt` úvodní stránky (https://llmstxt.org): krátký popis služby a odkazy na stránky
 * z mapy webu pro AI vyhledávače. Čistá funkce; texty dodá handler ze stejných překladů jako stránky.
 */

export interface LlmsLink {
  title: string;
  url: string;
  description: string;
}

export interface LlmsInput {
  name: string;
  summary: readonly string[];
  details: readonly string[];
  sections: readonly { heading: string; links: readonly LlmsLink[] }[];
}

/** Nezlomitelné mezery z typografie a „| Se vezmou“ v titulcích do prostého textu nepatří. */
const clean = (text: string) =>
  text
    .replace(/[  ]/g, " ")
    .replace(/\s*\|\s*[^|]+$/, "")
    .trim();

export function buildLlmsTxt(input: LlmsInput): string {
  const lines = [`# ${input.name}`, "", ...input.summary.map((line) => `> ${clean(line)}`), ""];
  lines.push(...input.details, "");
  for (const section of input.sections) {
    lines.push(`## ${section.heading}`, "");
    for (const link of section.links) {
      lines.push(`- [${clean(link.title)}](${link.url}): ${clean(link.description)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
