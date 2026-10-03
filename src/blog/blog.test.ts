import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import { localizedPath } from "@/i18n/pathnames";
import { findTypoViolations } from "@/i18n/typo";
import { articlePath, articleSchema, NEW_ARTICLE_ID } from "./article";
import { anchorId, parseBlocks, parseInline, plainText } from "./markdown";
import { allArticles } from "./store";

describe("zápis textu článku", () => {
  it("rozloží bloky", () => {
    const blocks = parseBlocks(
      "Úvod\npokračuje.\n\n## Co dál\n\n- a\n- b\n\n1. první\n2. druhý\n\n> Tip: pozor\n\n### Malý",
    );
    expect(blocks).toEqual([
      { type: "p", text: "Úvod pokračuje." },
      { type: "h2", text: "Co dál", id: "co-dal" },
      { type: "ul", items: ["a", "b"] },
      { type: "ol", items: ["první", "druhý"] },
      { type: "quote", text: "Tip: pozor" },
      { type: "h3", text: "Malý", id: "maly" },
    ]);
  });

  it("tučné písmo a odkazy; nebezpečný odkaz zůstane textem", () => {
    expect(parseInline("A **b** [c](/blog/x) [d](javascript:alert(1)) [e](//evil.cz)")).toEqual([
      { type: "text", text: "A " },
      { type: "strong", text: "b" },
      { type: "text", text: " " },
      { type: "link", text: "c", href: "/blog/x" },
      { type: "text", text: " " },
      { type: "text", text: "d" },
      { type: "text", text: ") " },
      { type: "text", text: "e" },
    ]);
  });

  it("kotva bez diakritiky", () => {
    expect(anchorId("Co na svatební web nepatří?")).toBe("co-na-svatebni-web-nepatri");
  });
});

describe("články v content/blog", () => {
  const articles = allArticles();
  const published = articles.filter((a) => a.status === "published");

  it("identifikátor stránky „nový článek“ je vyhrazený", () => {
    const ok = articleSchema.safeParse({ ...articles[0], id: NEW_ARTICLE_ID });
    expect(ok.success).toBe(false);
  });

  it("aspoň tři zveřejněné články", () => {
    expect(published.length).toBeGreaterThanOrEqual(3);
  });

  it("adresy jsou v každém jazyce jedinečné", () => {
    for (const locale of locales) {
      const slugs = articles.map((a) => a.translations[locale].slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  it("typografie podle jazyka (uvozovky, předložky, tři tečky)", () => {
    for (const article of articles) {
      for (const locale of locales) {
        const { title, description, body } = article.translations[locale];
        for (const text of [title, description, ...plainText(body)]) {
          expect(findTypoViolations(text, locale), `${article.id} ${locale}: ${text}`).toEqual([]);
        }
      }
    }
  });

  it("vnitřní odkazy vedou na existující stránku ve stejném jazyce", () => {
    for (const article of articles) {
      for (const locale of locales) {
        const known = new Set([
          localizedPath("home", locale),
          localizedPath("blog", locale),
          ...published.map((a) => articlePath(a, locale)),
        ]);
        const links = parseBlocks(article.translations[locale].body)
          .flatMap((block) => ("items" in block ? block.items : [block.text]))
          .flatMap(parseInline)
          .flatMap((part) =>
            part.type === "link" && part.href.startsWith("/") ? [part.href] : [],
          );
        for (const href of links) expect(known, `${article.id} ${locale}`).toContain(href);
      }
    }
  });

  it("kapitoly článku mají jedinečné kotvy", () => {
    for (const article of articles) {
      for (const locale of locales) {
        const ids = parseBlocks(article.translations[locale].body).flatMap((b) =>
          "id" in b ? [b.id] : [],
        );
        expect(new Set(ids).size, `${article.id} ${locale}`).toBe(ids.length);
      }
    }
  });
});
