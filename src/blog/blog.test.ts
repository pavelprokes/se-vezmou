import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArticleBody } from "@/components/blog/article-body";
import { locales } from "@/i18n/config";
import { localizedPath } from "@/i18n/pathnames";
import { findTypoViolations } from "@/i18n/typo";
import { indexableRoutes } from "@/seo/sitemap";
import { articlePath, articleSchema, articleState, NEW_ARTICLE_ID, pragueToday } from "./article";
import { anchorId, parseBlocks, parseInline, plainText } from "./markdown";
import { allArticles, publishedArticles } from "./store";

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

  // Odkaz na článek, který ještě nevyšel (koncept, naplánovaný), se na webu vykreslí jako text.
  it("vnitřní odkazy vedou na existující stránku nebo článek ve stejném jazyce", () => {
    for (const article of articles) {
      for (const locale of locales) {
        const known = new Set([
          ...indexableRoutes.map((route) => localizedPath(route, locale)),
          ...articles.map((a) => articlePath(a, locale)),
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

describe("naplánované zveřejnění", () => {
  const base = { status: "published", publishedAt: "2026-10-07" } as const;

  it("zveřejněný článek s budoucím datem je naplánovaný, v den vydání zveřejněný", () => {
    expect(articleState(base, "2026-10-06")).toBe("scheduled");
    expect(articleState(base, "2026-10-07")).toBe("published");
    expect(articleState({ ...base, status: "draft" }, "2026-12-01")).toBe("draft");
  });

  it("den vydání se počítá podle pražského času", () => {
    // 6. 10. ve 22:30 UTC je v Praze už 7. 10. (letní čas, UTC+2).
    expect(pragueToday(new Date("2026-10-06T22:30:00Z"))).toBe("2026-10-07");
    expect(pragueToday(new Date("2026-10-06T21:59:00Z"))).toBe("2026-10-06");
    // V zimě je Praha UTC+1: 23:30 UTC 2. 12. je už 3. 12.
    expect(pragueToday(new Date("2026-12-02T23:30:00Z"))).toBe("2026-12-03");
    expect(pragueToday(new Date("2026-12-02T22:59:00Z"))).toBe("2026-12-02");
  });

  it("na webu jsou jen články, jejichž den už nastal", () => {
    expect(publishedArticles("2000-01-01")).toEqual([]);
    const all = allArticles();
    const later = all
      .filter((a) => a.status === "published")
      .map((a) => a.publishedAt)
      .sort()
      .at(-1);
    // V den posledního naplánovaného článku je venku každý zveřejněný, žádný koncept.
    expect(
      publishedArticles(later)
        .map((a) => a.id)
        .sort(),
    ).toEqual(
      all
        .filter((a) => a.status === "published")
        .map((a) => a.id)
        .sort(),
    );
  });

  it("odkaz na nezveřejněný článek se vykreslí jako text", () => {
    const blocks = parseBlocks("Viz [dar](/blog/dar) a [web](/blog/web).");
    const html = renderToStaticMarkup(
      ArticleBody({ blocks, locale: "cs", unpublished: new Set(["/blog/dar"]) }),
    );
    expect(html).not.toContain('href="/blog/dar"');
    expect(html).toContain("dar");
    expect(html).toContain('href="/blog/web"');
  });
});
