import { describe, expect, it } from "vitest";
import { ALLOWED_BOTS, TRAINING_BOTS } from "@/config/robots";
import { closedRobots, marketingRobots } from "./robots";
import { buildSitemap, indexableRoutes } from "./sitemap";

describe("robots.txt", () => {
  it("úvodní stránka povolí vyhledávací a odpovědní roboty a odkáže na mapu webu", () => {
    const text = marketingRobots("https://se-vezmou.cz");
    for (const bot of ALLOWED_BOTS) expect(text).toContain(`User-agent: ${bot}`);
    expect(text).toContain("Sitemap: https://se-vezmou.cz/sitemap.xml");
  });

  it("trénovací roboty jsou zakázané a nikdy nejsou mezi povolenými", () => {
    const text = marketingRobots("https://se-vezmou.cz");
    const [allowed, blocked] = text.split("\n\n");
    expect(allowed.endsWith("Allow: /")).toBe(true);
    expect(blocked.endsWith("Disallow: /")).toBe(true);
    for (const bot of TRAINING_BOTS) {
      expect(blocked).toContain(`User-agent: ${bot}`);
      expect(allowed).not.toContain(`User-agent: ${bot}`);
    }
  });

  it("ostatní hostitelé jsou zavřeni", () => {
    expect(closedRobots()).toBe("User-agent: *\nDisallow: /\n");
  });
});

describe("sitemap.xml", () => {
  const xml = buildSitemap("https://se-vezmou.cz");

  it("obsahuje obě jazykové verze s alternativami", () => {
    expect(xml).toContain("<loc>https://se-vezmou.cz/</loc>");
    expect(xml).toContain("<loc>https://se-vezmou.cz/en</loc>");
    expect(xml.match(/hreflang="cs"/g)).toHaveLength(indexableRoutes.length * 2);
    expect(xml.match(/hreflang="en"/g)).toHaveLength(indexableRoutes.length * 2);
    expect(xml.match(/hreflang="x-default" href="https:\/\/se-vezmou.cz\/"/g)).toHaveLength(2);
  });

  it("je platný XML dokument s deklarací jmenného prostoru xhtml", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
  });

  it("neobsahuje zástupné právní podstránky (noindex)", () => {
    expect(xml).not.toMatch(/soukromi|privacy|podminky|terms|dostupnost|accessibility/);
    expect(indexableRoutes).toEqual(["home", "pricing", "templates", "bilingual"]);
  });

  it("obsahuje cenu, šablony a dvojjazyčný web v obou jazycích", () => {
    for (const path of [
      "/cenik",
      "/en/pricing",
      "/sablony",
      "/en/templates",
      "/dvojjazycny-svatebni-web",
      "/en/bilingual-wedding-website",
    ]) {
      expect(xml).toContain(`<loc>https://se-vezmou.cz${path}</loc>`);
    }
  });

  it("šlo by do mapy přidat další stránku po doplnění textu", () => {
    const withPrivacy = buildSitemap("https://se-vezmou.cz", ["home", "privacy"]);
    expect(withPrivacy).toContain("<loc>https://se-vezmou.cz/soukromi</loc>");
    expect(withPrivacy).toContain("<loc>https://se-vezmou.cz/en/privacy</loc>");
  });

  it("neobsahuje app, admin ani weby párů", () => {
    expect(xml).not.toMatch(/app\.|admin\.|klara/);
  });
});
