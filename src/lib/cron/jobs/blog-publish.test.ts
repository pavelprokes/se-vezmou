import { afterEach, describe, expect, it, vi } from "vitest";
import { findArticle } from "@/blog/store";
import type { JobContext } from "../run";
import { blogPublishJob, checksFor, warmUntilReady } from "./blog-publish";

/** 00:01 7. 10. 2026 v Praze (letní čas, UTC+2): den vydání naplánovaného článku o svatebním daru. */
const MIDNIGHT = new Date("2026-10-06T22:01:00Z");
const ARTICLE_CS = "/blog/svatebni-dar-na-ucet-qr-platba";
const ARTICLE_EN = "/en/blog/wedding-cash-gift-bank-transfer-qr";

function context(dryRun = false): JobContext {
  return { now: MIDNIGHT, dryRun, batch: 100, weddingId: null, timeLeftMs: () => 50_000 };
}

/** Falešný web: rozcestníky, mapa webu a llms.txt odkazují na oba jazyky článku, článek je 200. */
function site(listed: boolean) {
  return vi.fn(async (url: URL) => {
    const path = url.pathname;
    if (path === ARTICLE_CS || path === ARTICLE_EN) return new Response("článek");
    return new Response(listed ? `${ARTICLE_CS} ${ARTICLE_EN}` : "starý obsah");
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("zveřejnění naplánovaných článků", () => {
  it("dnešní článek musí být vidět na své adrese, v rozcestníku, mapě webu a llms.txt", () => {
    const article = findArticle("svatebni-dar-qr-platba");
    if (!article) throw new Error("chybí článek");
    const checks = checksFor([article]);
    expect(checks.map((c) => c.path)).toEqual([
      "/blog",
      ARTICLE_CS,
      "/en/blog",
      ARTICLE_EN,
      "/sitemap.xml",
      "/llms.txt",
    ]);
    const index = checks[0];
    expect(index.ready(200, `<a href="${ARTICLE_CS}">`)).toBe(true);
    expect(index.ready(200, "bez článku")).toBe(false);
    expect(checks[1].ready(404, "")).toBe(false);
  });

  it("načte stránky a ohlásí, že jsou připravené", async () => {
    const fetch = site(true);
    vi.stubGlobal("fetch", fetch);
    const result = await blogPublishJob.run(context());
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(result).toEqual({
      status: "ok",
      counts: { published_today: 1, ready: 6, not_ready: 0 },
    });
  });

  it("stará verze stránky (ISR) se načítá znovu, dokud se článek neobjeví", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(++calls < 3 ? "starý obsah" : ARTICLE_CS)),
    );
    const check = {
      path: "/blog",
      ready: (s: number, b: string) => s === 200 && b.includes(ARTICLE_CS),
    };
    expect(await warmUntilReady(check, Date.now() + 1_000, 1)).toBe(true);
    expect(calls).toBe(3);
  });

  it("když se do limitu neobjeví, je to částečný úspěch, ne pád", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("starý obsah")),
    );
    const check = { path: "/blog", ready: (s: number, b: string) => b.includes(ARTICLE_CS) };
    expect(await warmUntilReady(check, Date.now() + 20, 5)).toBe(false);
    vi.stubGlobal("fetch", site(false));
    const result = await blogPublishJob.run({ ...context(), timeLeftMs: () => 0 });
    expect(result.status).toBe("partial");
    expect(result.counts).toMatchObject({ ready: 2, not_ready: 4 });
  });

  it("den bez nového článku jen načte rozcestníky, mapu webu a llms.txt", () => {
    expect(checksFor([]).map((c) => c.path)).toEqual([
      "/blog",
      "/en/blog",
      "/sitemap.xml",
      "/llms.txt",
    ]);
  });

  it("dry_run nic nenačte", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = await blogPublishJob.run(context(true));
    expect(fetch).not.toHaveBeenCalled();
    expect(result.counts.published_today).toBe(1);
  });
});
