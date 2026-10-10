import { describe, expect, it } from "vitest";
import { ALLOWED_BOTS, LINK_PREVIEW_BOTS, TRAINING_BOTS } from "@/config/robots";
import { closedRobots, marketingRobots, tenantRobots } from "./robots";
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

  it("web páru pustí jen roboty náhledů odkazů, ostatní zavře", () => {
    const [previews, rest] = tenantRobots().split("\n\n");
    for (const bot of LINK_PREVIEW_BOTS) expect(previews).toContain(`User-agent: ${bot}`);
    expect(previews.endsWith("Allow: /")).toBe(true);
    expect(rest).toBe("User-agent: *\nDisallow: /\n");
  });
});

describe("sitemap.xml", () => {
  const xml = buildSitemap("https://se-vezmou.cz");

  it("obsahuje obě jazykové verze s alternativami", () => {
    expect(xml).toContain("<loc>https://se-vezmou.cz/</loc>");
    expect(xml).toContain("<loc>https://se-vezmou.cz/en</loc>");
    expect(xml).toContain("<loc>https://se-vezmou.cz/blog</loc>");
    expect(xml).toContain("<loc>https://se-vezmou.cz/en/blog</loc>");
    expect(xml.match(/hreflang="cs"/g)).toHaveLength(indexableRoutes.length * 2);
    expect(xml.match(/hreflang="en"/g)).toHaveLength(indexableRoutes.length * 2);
    expect(xml.match(/hreflang="x-default" href="https:\/\/se-vezmou.cz\/"/g)).toHaveLength(2);
  });

  it("je platný XML dokument s deklarací jmenného prostoru xhtml", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
  });

  it("obsahuje právní podstránky v obou jazycích", () => {
    for (const path of [
      "soukromi",
      "podminky",
      "dostupnost",
      "en/privacy",
      "en/terms",
      "en/accessibility",
    ])
      expect(xml).toContain(`<loc>https://se-vezmou.cz/${path}</loc>`);
    expect(indexableRoutes).toEqual([
      "home",
      "pricing",
      "templates",
      "bilingual",
      "rsvp",
      "seating",
      "photographers",
      "blog",
      "privacy",
      "terms",
      "accessibility",
    ]);
  });

  it("obsahuje cenu, šablony a dvojjazyčný web v obou jazycích", () => {
    for (const path of [
      "/cenik",
      "/en/pricing",
      "/sablony",
      "/en/templates",
      "/dvojjazycny-svatebni-web",
      "/en/bilingual-wedding-website",
      "/potvrzeni-ucasti-hostu",
      "/en/wedding-rsvp",
      "/zasedaci-poradek-na-svatbu",
      "/en/wedding-seating-plan",
      "/pro-fotografy",
      "/en/for-photographers",
    ]) {
      expect(xml).toContain(`<loc>https://se-vezmou.cz${path}</loc>`);
    }
  });

  it("článek blogu se přidá s adresami v každém jazyce", () => {
    const withArticle = buildSitemap("https://se-vezmou.cz", [
      { cs: "/blog/svatebni-web", en: "/en/blog/wedding-website" },
    ]);
    expect(withArticle).toContain("<loc>https://se-vezmou.cz/blog/svatebni-web</loc>");
    expect(withArticle).toContain(
      '<xhtml:link rel="alternate" hreflang="en" href="https://se-vezmou.cz/en/blog/wedding-website" />',
    );
  });

  it("lastmod je jen u stránek, které ho mají zadaný", () => {
    const article = { cs: "/blog/a", en: "/en/blog/a" };
    const xml = buildSitemap(
      "https://se-vezmou.cz",
      ["home", article],
      new Map([[article, "2026-10-05"]]),
    );
    expect(xml.match(/<lastmod>2026-10-05<\/lastmod>/g)).toHaveLength(2);
    expect(xml.match(/<lastmod>/g)).toHaveLength(2);
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
