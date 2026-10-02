import { MEDIA_LIMITS } from "@/lib/media/limits";
import { getMemoryStorage } from "@/lib/storage";
import { parseKey } from "@/lib/storage/types";

/**
 * Vývojová a testovací obdoba podepsaných adres R2 (jen s úložištěm v paměti, `src/lib/storage/memory.ts`):
 * nahrání (PUT) a čtení (GET) objektu podle podepsané adresy. S R2, nebo když úložiště v paměti není zapnuté
 * (produkce), cesta vůbec neexistuje (404). Podpis je HMAC s náhodným klíčem procesu a platností, takže adresa
 * nejde použít na jiný objekt, jinou metodu ani po vypršení. Cesta je vyňatá z proxy (`src/proxy.ts`), aby fungovala
 * na každém hostiteli, stejně jako adresa úložiště.
 */

const NOT_FOUND = () =>
  new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

function signed(request: Request, method: "GET" | "PUT") {
  const memory = getMemoryStorage();
  if (!memory) return null;
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const expires = Number(url.searchParams.get("expires"));
  const signature = url.searchParams.get("sig") ?? "";
  if (!parseKey(key) || !memory.verify({ method, key, expires, signature })) return null;
  return { memory, key, url };
}

export async function GET(request: Request) {
  const ok = signed(request, "GET");
  if (!ok) return NOT_FOUND();
  const body = await ok.memory.getObject(ok.key, { maxBytes: MEDIA_LIMITS.maxBytes * 2 });
  if (!body) return NOT_FOUND();
  const name = ok.url.searchParams.get("name");
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": ok.memory.contentType(ok.key) ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      ...(name
        ? {
            "Content-Disposition": `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
          }
        : {}),
    },
  });
}

export async function PUT(request: Request) {
  const ok = signed(request, "PUT");
  if (!ok) return NOT_FOUND();
  const declared = Number(request.headers.get("content-length") ?? 0);
  // Stejný strop jako v databázi; skutečné ověření limitu a obsahu dělá zpracování při dokončení.
  if (declared > MEDIA_LIMITS.maxBytes * 2) return new Response(null, { status: 413 });
  const bytes = Buffer.from(await request.arrayBuffer());
  await ok.memory.putObject(ok.key, bytes, {
    contentType: request.headers.get("content-type") ?? "application/octet-stream",
  });
  return new Response(null, { status: 200 });
}
