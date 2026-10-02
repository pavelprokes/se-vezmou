import { RATE_RULES } from "@/auth/config";
import { rateKey } from "@/auth/rate-limit";
import { assertSameOrigin, getUiLocale } from "@/auth/request";
import { getSession } from "@/auth/session";
import { requireEnv } from "@/env";
import { rateLimitHit } from "@/lib/db/rpc";
import { exportGuestsAndRsvp } from "@/lib/export/service";

/**
 * Stažení hostů a odpovědí jako CSV nebo Excel (FR-LC-2) přihlášeným správcem. POST (formulář), ne
 * odkaz: soubor s osobními údaji nemá mít adresu, kterou si prohlížeč nebo proxy pamatuje. Kontrola
 * původu a relace jako u každé akce; databázová funkce navíc zapíše audit `export.guests` bez osobních
 * údajů. Dieta a alergie jen při výslovné volbě `health`.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await assertSameOrigin();
  } catch {
    return new Response(null, { status: 403 });
  }
  const session = await getSession();
  if (!session) return new Response(null, { status: 401 });

  const limit = await rateLimitHit(
    rateKey(requireEnv("RATE_LIMIT_SECRET"), "export-wedding", session.weddingId),
    RATE_RULES.exportWedding.limit,
    RATE_RULES.exportWedding.windowSeconds,
  );
  if (!limit.allowed) {
    return new Response(null, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfter) },
    });
  }

  const form = await request.formData().catch(() => null);
  const format = form?.get("format") === "csv" ? "csv" : "xlsx";
  const includeHealth = form?.get("health") === "1";

  const file = await exportGuestsAndRsvp(
    { weddingId: session.weddingId, subjectId: session.subjectId },
    { format, locale: await getUiLocale(), includeHealth },
  );
  return new Response(new Uint8Array(file.body), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
