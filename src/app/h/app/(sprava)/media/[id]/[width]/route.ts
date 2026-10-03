import { getSession } from "@/auth/session";
import { adminMediaVariant } from "@/lib/db/media";
import { mediaNotFound, mediaRedirect, parseMediaRequest } from "@/lib/media/delivery";

/**
 * Náhledy fotografií v rozhraní správy (`/media/{media_id}/{šířka}` na hostiteli `app.`): jen pro přihlášeného
 * správce a jen fotografie jeho svatby, i nezveřejněné (editor galerie a živý náhled webu). Stejné přesměrování na
 * podepsanou adresu úložiště jako na webu páru; bez relace nebo u cizího média prázdné 404.
 */
export async function GET(request: Request, context: RouteContext<"/h/app/media/[id]/[width]">) {
  const { id, width } = await context.params;
  const media = parseMediaRequest(id, width, new URL(request.url).searchParams.get("f"));
  if (!media) return mediaNotFound();
  try {
    const session = await getSession();
    if (!session) return mediaNotFound();
    const key = await adminMediaVariant(session, media);
    if (!key) return mediaNotFound();
    return await mediaRedirect(key, { cache: "admin" });
  } catch (error) {
    console.error("[fotografie] náhled selhal", error instanceof Error ? error.name : "");
    return new Response(null, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
