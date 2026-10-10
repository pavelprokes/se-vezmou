import { renderGallerySignPdf } from "@/admin/gallery-sign/pdf";
import { loadGallerySign, parseGallerySignOptions } from "@/admin/gallery-sign/server";
import { RATE_RULES } from "@/auth/config";
import { assertSameOrigin, getUiLocale } from "@/auth/request";
import { getSession } from "@/auth/session";
import { getTranslator } from "@/i18n/load";
import { limited } from "@/lib/rate-guard";

/**
 * Stažení PDF cedulky s QR galerie přihlášeným správcem. POST jako u jmenovek: adresa galerie může
 * nést tajný token (přístup do galerie), soubor nemá mít adresu, kterou si prohlížeč pamatuje.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await assertSameOrigin();
  } catch {
    return new Response(null, { status: 403 });
  }
  const session = await getSession();
  if (!session) return new Response(null, { status: 401 });

  const retryAfter = await limited(
    "gallery-sign-pdf",
    session.weddingId,
    RATE_RULES.gallerySignPdfWedding,
  );
  if (retryAfter !== null) {
    return new Response(null, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  const form = await request.formData().catch(() => null);
  const options = parseGallerySignOptions((key) => form?.get(key));
  const data = await loadGallerySign(session, options);
  if (!data.content || !data.qrUrl) return new Response(null, { status: 404 });

  const t = await getTranslator(await getUiLocale(), ["admin"]);
  const bytes = await renderGallerySignPdf({
    locale: data.languages[0],
    format: options.format,
    content: data.content,
    style: data.style,
    qrUrl: data.qrUrl,
    title: data.couple
      ? t("admin.gallerySign.pdfTitleCouple", { couple: data.couple })
      : t("admin.gallerySign.title"),
  });
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="cedulka-galerie${data.slug ? `-${data.slug}` : ""}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
