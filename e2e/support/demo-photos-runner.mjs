// Pomocník e2e/demo-seed.e2e.ts: spustí demo skript se STEJNÝM kódem jako u R2, jen s úložištěm v paměti
// tohoto procesu (aplikace v e2e má úložiště v paměti vlastního procesu, soubory by se tam nedostaly), a po
// každém kroku vypíše na standardní výstup JSON s naměřeným stavem. Spouští se `node --import tsx`.
//   node --import tsx e2e/support/demo-photos-runner.mjs <adresa> <e-mail správce> <PIN hostů> <PIN správy>
import pg from "pg";
import { clientConfig } from "../../scripts/db-migrate.mjs";
import { loadLibs, parseArgs, runDemo } from "../../scripts/demo-seed.mjs";
import { createMemoryStorage } from "../../src/lib/storage/memory.ts";

const [slug, email, guestPin, sitePin] = process.argv.slice(2);
const env = { ...process.env };
const storage = createMemoryStorage();
const libs = await loadLibs();
const client = new pg.Client(clientConfig(process.env.MIGRATE_DATABASE_URL));
await client.connect();

async function measure(step) {
  const w = (await client.query("select id from se_vezmou.weddings where slug = $1", [slug]))
    .rows[0];
  if (!w) return { step, wedding: false };
  const media = (
    await client.query(
      "select status, kind, decorative, alt from se_vezmou.media where wedding_id = $1 order by created_at",
      [w.id],
    )
  ).rows;
  const snapshot = (
    await client.query(
      "select v.public_content from se_vezmou.site_versions v join se_vezmou.weddings x on x.published_version_id = v.id where x.id = $1",
      [w.id],
    )
  ).rows[0]?.public_content;
  const gallery = snapshot?.blocks.find((b) => b.type === "gallery");
  return {
    step,
    wedding: true,
    files: (await storage.listPrefix(w.id)).length,
    media,
    snapshotMedia: snapshot?.media ?? [],
    galleryIds: gallery?.data.mediaIds.length ?? null,
  };
}

const base = [
  "--slug",
  slug,
  "--admin-email",
  email,
  "--guest-pin",
  guestPin,
  "--site-pin",
  sitePin,
];
const go = async (step, extra = []) => {
  const result = await runDemo({
    client,
    opts: parseArgs([...base, ...extra], env),
    env,
    log: () => undefined,
    storage,
    libs,
    now: new Date(),
  });
  return { ...(await measure(step)), photos: result.photos ?? null };
};

const out = [];
out.push(await go("create"));
out.push(await go("again"));
out.push(await go("reset", ["--reset"]));
out.push(await go("delete", ["--delete"]));
out.push({ expected: libs.content.DEMO_PHOTOS.length });
await client.end();
console.log(JSON.stringify(out));
