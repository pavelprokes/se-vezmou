/**
 * Vygeneruje obrázky pro sdílení (`public/og/se-vezmou-cs.png` a `-en.png`, 1200 × 630) z SVG.
 * Spouští se ručně při změně vzhledu nebo textu: `node scripts/generate-og.mjs`.
 * Používá `sharp` (nainstaluje ho Next.js) a systémová písma (serif, sans-serif), takže výsledek
 * se kontroluje okem a PNG se commitují. Barvy jsou tokeny značky z `src/app/globals.css`.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public/og");
// Logo A (docs/brand): tělo SVG bez obalu, text je převedený na křivky.
const logo = readFileSync(join(root, "docs/brand/logo-a-prsteny.svg"), "utf8")
  .replace(/^<svg[^>]*>\n?/, "")
  .replace(/<\/svg>\s*$/, "");
mkdirSync(out, { recursive: true });

const c = {
  parchment: "#f7f4ed",
  warm: "#efebe1",
  ink: "#1b2a23",
  pine: "#365c4e",
  linen: "#d9e1d7",
  cinnamon: "#b66d55",
  cinnamonDeep: "#8e503c",
};

const texts = {
  cs: {
    size: 60,
    eyebrowSize: 22,
    eyebrow: "SVATEBNÍ WEB BEZ STAROSTÍ",
    line1: "Vaše svatba.",
    line2: "Všechno důležité",
    line3: "na jednom místě.",
    invite: "ZVEME VÁS",
    rsvp: "POTVRDIT ÚČAST",
    dateplace: "12. června 2027 · Praha",
    first: "Klára",
    second: "Matěj",
  },
  en: {
    size: 50,
    eyebrowSize: 18,
    eyebrow: "A WEDDING WEBSITE WITHOUT THE FUSS",
    line1: "Your wedding.",
    line2: "Everything that matters",
    line3: "in one place.",
    invite: "YOU ARE INVITED",
    rsvp: "CONFIRM ATTENDANCE",
    dateplace: "12 June 2027 · Prague",
    first: "Emma",
    second: "Thomas",
  },
};

function svg(t) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${c.parchment}"/>
  <g transform="translate(60 28) scale(0.5)">${logo}</g>
  <text x="72" y="190" font-family="sans-serif" font-size="${t.eyebrowSize}" font-weight="700" letter-spacing="3" fill="${c.cinnamonDeep}">${t.eyebrow}</text>
  <text x="72" y="280" font-family="serif" font-size="${t.size}" fill="${c.ink}">${t.line1}</text>
  <text x="72" y="352" font-family="serif" font-size="${t.size}" fill="${c.ink}">${t.line2}</text>
  <text x="72" y="424" font-family="serif" font-size="${t.size}" fill="${c.cinnamon}">${t.line3}</text>
  <g transform="translate(150 50) scale(0.84)">
  <circle cx="930" cy="330" r="230" fill="${c.linen}"/>
  <rect x="640" y="150" width="190" height="260" rx="16" fill="${c.cinnamon}" transform="rotate(-5 735 280)"/>
  <text x="654" y="330" font-family="serif" font-size="120" fill="${c.parchment}" transform="rotate(-5 735 280)">${t.first[0]}</text>
  <rect x="720" y="190" width="400" height="290" rx="18" fill="${c.parchment}" stroke="${c.pine}" stroke-opacity="0.25" stroke-width="2"/>
  <path d="M720 208a18 18 0 0 1 18-18h364a18 18 0 0 1 18 18v28H720z" fill="${c.warm}"/>
  <text x="920" y="296" font-family="sans-serif" font-size="14" font-weight="700" letter-spacing="3" text-anchor="middle" fill="${c.cinnamonDeep}">${t.invite}</text>
  <text x="920" y="350" font-family="serif" font-size="56" text-anchor="middle" fill="${c.pine}">${t.first}</text>
  <text x="920" y="408" font-family="serif" font-size="56" text-anchor="middle" fill="${c.pine}">&amp; ${t.second}</text>
  <text x="920" y="436" font-family="sans-serif" font-size="14" text-anchor="middle" fill="${c.ink}">${t.dateplace}</text>
  <rect x="825" y="446" width="190" height="26" rx="8" fill="${c.pine}"/>
  <text x="920" y="464" font-family="sans-serif" font-size="12" font-weight="700" letter-spacing="1" text-anchor="middle" fill="${c.parchment}">${t.rsvp}</text>
  </g>
  <rect y="590" width="1200" height="40" fill="${c.cinnamonDeep}"/>
</svg>`;
}

for (const [locale, t] of Object.entries(texts)) {
  const source = svg(t);
  await sharp(Buffer.from(source))
    .png({ compressionLevel: 9 })
    .toFile(join(out, `se-vezmou-${locale}.png`));
  console.log(`public/og/se-vezmou-${locale}.png`);
}
