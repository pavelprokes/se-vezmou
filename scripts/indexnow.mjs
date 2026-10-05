#!/usr/bin/env node
/**
 * IndexNow: oznámí Bingu, Seznamu a dalším vyhledávačům protokolu IndexNow adresy z mapy webu, aby nové
 * a změněné stránky nečekaly, až je roboti najdou sami (Google IndexNow nepoužívá, tomu stačí Search Console).
 * Spouští ho `.github/workflows/indexnow.yml` po úspěšném produkčním nasazení na Vercelu, ručně:
 * `node scripts/indexnow.mjs` (volba `--dry-run` jen vypíše adresy).
 *
 * Klíč není tajný: prokazuje jen vlastnictví domény a leží veřejně v `public/<klíč>.txt`. Nový klíč = nový
 * soubor a změna konstanty níže.
 *
 * ponytail: posílá vždy celou mapu webu (desítky adres). Až budou stovky, posílat jen adresy se změněným `lastmod`.
 */

const SITE = "https://se-vezmou.cz";
const KEY = "30e95dcbaab848a8237b081b30d89194";
const ENDPOINT = "https://api.indexnow.org/indexnow";

export function sitemapUrls(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const keyLocation = `${SITE}/${KEY}.txt`;

  // Bez dostupného klíče by vyhledávače žádost odmítly; selhat tady je čitelnější.
  const keyResponse = await fetch(keyLocation);
  const served = (await keyResponse.text()).trim();
  if (!keyResponse.ok || served !== KEY) {
    throw new Error(`Soubor s klíčem ${keyLocation} nevrací klíč (HTTP ${keyResponse.status}).`);
  }

  const sitemap = await fetch(`${SITE}/sitemap.xml`);
  if (!sitemap.ok) throw new Error(`Mapa webu vrací HTTP ${sitemap.status}.`);
  const urlList = sitemapUrls(await sitemap.text()).filter(
    (url) => url.startsWith(`${SITE}/`) || url === SITE,
  );
  if (urlList.length === 0) throw new Error("Mapa webu neobsahuje žádnou adresu.");

  if (dryRun) {
    console.log(urlList.join("\n"));
    return;
  }
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: new URL(SITE).host, key: KEY, keyLocation, urlList }),
  });
  // 200 = přijato, 202 = přijato, klíč se teprve ověří
  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`IndexNow vrátil HTTP ${response.status}: ${await response.text()}`);
  }
  console.log(`IndexNow: odesláno ${urlList.length} adres (HTTP ${response.status}).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
