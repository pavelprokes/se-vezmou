import { getGuestSession, guestIdentity } from "@/auth/guest-session";
import { getPublicMedia, visitorIdentity } from "@/lib/db/media";
import { resolveSlug } from "@/lib/db/rpc";
import { mediaNotFound, mediaRedirect, parseMediaRequest } from "@/lib/media/delivery";

/**
 * Fotografie na webu páru: `/media/{media_id}/{šířka}` (formát `?f=avif|webp`). Tenhle handler je jediná cesta, jak
 * se obrázek dostane k hostovi: bucket je privátní a bez veřejné adresy.
 *
 * Kontroluje (v databázi, `get_public_media`): svatba je zveřejněná a nesmazaná (po retenci je web archivovaný,
 * tedy 404), médium je hotové a je ve ZVEŘEJNĚNÉM snímku, varianta existuje. Fotografie chráněné PINem hostů vidí
 * jen host s platnou relací po PINu (stejná cookie jako u ostatních citlivých bloků). Cokoli jiného je totéž
 * prázdné 404, takže nelze zjistit, co existuje. Odpověď je přesměrování na čerstvě podepsanou adresu úložiště
 * (podpis se váže na časové okno, takže je adresa stabilní), s krátkým `Cache-Control` a `X-Robots-Tag: noindex`.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/h/tenant/[slug]/[locale]/media/[id]/[width]">,
) {
  const { slug, id, width } = await context.params;
  const media = parseMediaRequest(id, width, new URL(request.url).searchParams.get("f"));
  if (!media || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) return mediaNotFound();

  try {
    const resolved = await resolveSlug(slug);
    if (!resolved) return mediaNotFound();
    // Host po PINu vidí i chráněné fotografie; bez cookie se nesahá do databáze vůbec.
    const guest = await getGuestSession(resolved.weddingId);
    const identity = guest ? guestIdentity(guest) : visitorIdentity(resolved.weddingId);
    const found = await getPublicMedia(identity, media);
    if (!found) return mediaNotFound();
    return await mediaRedirect(found.key);
  } catch (error) {
    // Bez klíče, adresy a identifikátorů: jen druh chyby. Obrázek se prostě nezobrazí (alt text zůstane).
    console.error("[fotografie] doručení selhalo", error instanceof Error ? error.name : "");
    return new Response(null, {
      status: 503,
      headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" },
    });
  }
}
