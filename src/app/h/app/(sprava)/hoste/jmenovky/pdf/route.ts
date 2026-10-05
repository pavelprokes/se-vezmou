import { loadNameCards, parseNameCardOptions } from "@/admin/name-cards/server";
import { cardFaces, renderNameCardsPdf } from "@/admin/name-cards/pdf";
import { RATE_RULES } from "@/auth/config";
import { assertSameOrigin, getUiLocale } from "@/auth/request";
import { getSession } from "@/auth/session";
import { getTranslator } from "@/i18n/load";
import { limited } from "@/lib/rate-guard";

/**
 * Stažení PDF jmenovek přihlášeným správcem. POST jako export hostů: soubor se jmény hostů nemá mít
 * adresu, kterou si prohlížeč nebo proxy pamatuje. Jména, šablona a paleta se berou z databáze,
 * z formuláře jen volby (kdo, formát, skupina, řádek s datem).
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
    "name-cards-pdf",
    session.weddingId,
    RATE_RULES.nameCardsPdfWedding,
  );
  if (retryAfter !== null) {
    return new Response(null, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  const form = await request.formData().catch(() => null);
  const options = parseNameCardOptions((key) => form?.get(key));
  const data = await loadNameCards(session, options);
  const faces = await cardFaces(data.names, data.detail, data.style, options.format);
  if (faces.length === 0) return new Response(null, { status: 404 });

  const t = await getTranslator(await getUiLocale(), ["admin.guests"]);
  const bytes = await renderNameCardsPdf({
    locale: data.locale,
    faces,
    format: options.format,
    style: data.style,
    title: data.couple
      ? t("admin.guests.nameCards.pdfTitleCouple", { couple: data.couple })
      : t("admin.guests.nameCards.title"),
  });
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="jmenovky${data.slug ? `-${data.slug}` : ""}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
