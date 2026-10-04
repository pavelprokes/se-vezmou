/**
 * Vygeneruje ikony značky z návrhu loga A (`docs/brand/`): `src/app/icon.svg`, `src/app/favicon.ico`
 * (16, 32 a 48 px), `src/app/apple-icon.png` (180 px) a `public/icons/*.png` (Android, PWA, maskable).
 * Spouští se ručně při změně loga: `node scripts/generate-icons.mjs`. PNG se commitují.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const favicon = join(root, "docs/brand/favicon-a.svg");
const symbol = readFileSync(join(root, "docs/brand/symbol-a.svg"), "utf8");
const parchment = "#f7f4ed";
mkdirSync(join(root, "public/icons"), { recursive: true });

copyFileSync(favicon, join(root, "src/app/icon.svg"));

/** Symbol na plném pozadí; `scale` je podíl plochy, který zabere symbol (maskable: bezpečná zóna 80 %). */
async function tile(size, scale) {
  const inner = Math.round(size * scale);
  const mark = await sharp(Buffer.from(symbol), { density: 600 })
    .resize(inner, inner)
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: parchment } })
    .composite([{ input: mark, gravity: "centre" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}
const write = async (path, buf) => writeFileSync(join(root, path), await buf);
await write("src/app/apple-icon.png", tile(180, 0.82));
await write("public/icons/icon-192.png", tile(192, 0.82));
await write("public/icons/icon-512.png", tile(512, 0.82));
await write("public/icons/icon-maskable-512.png", tile(512, 0.6));

// ICO s PNG obsahem (16, 32, 48 px), průhledné pozadí.
const sizes = [16, 32, 48];
const pngs = await Promise.all(
  sizes.map((s) => sharp(favicon, { density: 600 }).resize(s, s).png().toBuffer()),
);
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const at = 6 + 16 * i;
  head.writeUInt8(s, at);
  head.writeUInt8(s, at + 1);
  head.writeUInt16LE(1, at + 4);
  head.writeUInt16LE(32, at + 6);
  head.writeUInt32LE(pngs[i].length, at + 8);
  head.writeUInt32LE(offset, at + 12);
  offset += pngs[i].length;
});
writeFileSync(join(root, "src/app/favicon.ico"), Buffer.concat([head, ...pngs]));
console.log("ikony hotové");
