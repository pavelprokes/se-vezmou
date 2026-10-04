import { requireEnv } from "@/env";
import { currentHostConfig } from "@/auth/app-origin";
import { verifyPin } from "@/auth/pin";
import { normalizePinInput } from "@/auth/pin-format";
import { assertSameOrigin, getHost, getUiLocale } from "@/auth/request";
import { getSession } from "@/auth/session";
import { RATE_RULES } from "@/auth/config";
import { authPinGet, authSessionContext } from "@/lib/db/rpc";
import { limited } from "@/lib/rate-guard";
import { getPublicContent } from "@/site/content";
import { pickGalleryUrl, renderAnnouncementPdf } from "@/wizard/pdf/announcement";
import { displayHost, siteUrl } from "@/wizard/urls";

/**
 * Stažení PDF oznámení k tisku (adresa, QR kód, případně druhý QR kód veřejné fotogalerie a PIN hostů) pro zveřejněný web přihlášeného
 * správce. POST z obrazovky „Hotovo“ nese PIN, který se jinde nikde nezobrazuje (v databázi je jen
 * jeho hash): server ho před tiskem ověří proti hashi, takže se do PDF nedostane PIN, který
 * k webu nepatří. Adresa, jména a datum se berou ze zveřejněného webu, ne z požadavku.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await assertSameOrigin();
  } catch {
    return new Response(null, { status: 403 });
  }

  const session = await getSession();
  if (!session) return new Response(null, { status: 401 });

  // Každé stažení ověřuje PIN (argon2id): bez omezení by šlo smyčkou vytěžovat server a zkoušet PINy.
  const retryAfter = await limited(
    "announcement-pdf",
    session.weddingId,
    RATE_RULES.announcementPdfWedding,
  );
  if (retryAfter !== null) {
    return new Response(null, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  const context = await authSessionContext(session.weddingId);
  if (!context || context.status !== "published" || !context.slug) {
    return new Response(null, { status: 404 });
  }
  // jako správce: i zamčený web (heslo na celý web) má pro tisk oznámení svůj obsah
  const content = await getPublicContent(context.slug, {
    weddingId: session.weddingId,
    weddingRole: "admin",
    subject: session.subjectId,
  });
  if (!content) return new Response(null, { status: 404 });

  let pin: string | null = null;
  const form = await request.formData().catch(() => null);
  const submitted = form?.get("pin");
  if (typeof submitted === "string") {
    const candidate = normalizePinInput(submitted);
    const record = await authPinGet(context.slug, "guest");
    if (record && (await verifyPin(record.pinHash, candidate, requireEnv("PIN_PEPPER")))) {
      pin = candidate;
    }
  }

  const locale = await getUiLocale();
  const host = await getHost();
  const root = currentHostConfig().rootDomains[0];
  const bytes = await renderAnnouncementPdf({
    locale,
    partners: content.partners,
    startsOn: content.startsOn,
    endsOn: content.endsOn,
    host: displayHost(context.slug, host, root),
    url: siteUrl(context.slug, host, content.defaultLocale, root),
    pin,
    galleryUrl: pickGalleryUrl(content.blocks),
  });

  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="oznameni-${context.slug}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
