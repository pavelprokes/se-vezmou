import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sitemapUrls } from "./indexnow.mjs";

describe("IndexNow", () => {
  it("vytáhne adresy z mapy webu", () => {
    const xml = `<urlset><url><loc>https://se-vezmou.cz/</loc></url><url><loc> https://se-vezmou.cz/cenik </loc></url></urlset>`;
    expect(sitemapUrls(xml)).toEqual(["https://se-vezmou.cz/", "https://se-vezmou.cz/cenik"]);
  });

  it("klíč ve skriptu má veřejný soubor se stejným obsahem", () => {
    const key = /const KEY = "([0-9a-f]{32})"/.exec(
      readFileSync("scripts/indexnow.mjs", "utf8"),
    )?.[1];
    expect(key).toBeDefined();
    expect(readFileSync(`public/${key}.txt`, "utf8").trim()).toBe(key);
  });
});
