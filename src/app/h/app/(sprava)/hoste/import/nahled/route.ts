import { IMPORT_LIMITS } from "@/admin/guests/import-parse";
import { previewImport } from "@/admin/guests/server";
import { assertSameOrigin } from "@/auth/request";
import { getSession } from "@/auth/session";

/**
 * Náhled importu hostů (FR-ADM-4): přijme soubor, přečte ho a ověří a vrátí řádky s chybami a
 * duplicitami. Nic se nezapisuje ani neukládá. Cesta, ne Server Action, protože Server Actions mají
 * pevný limit těla a nahrávání souboru tu má vlastní, přísnější: velikost se kontroluje už z hlavičky
 * a pak znovu ze skutečných bajtů. Odpověď nese stav, nikdy obsah souboru v chybě ani v logu.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await assertSameOrigin();
  } catch {
    return Response.json({ status: "error" }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return Response.json({ status: "unauthorized" }, { status: 401 });

  // Hlavička je jen nápověda (klient může lhát); skutečná velikost se ověří níže. Rezerva na obal formuláře.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > IMPORT_LIMITS.fileBytes + 64 * 1024) {
    return Response.json({ status: "failed", reason: "too_large" });
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ status: "failed", reason: "unreadable" });
    if (file.size > IMPORT_LIMITS.fileBytes) {
      return Response.json({ status: "failed", reason: "too_large" });
    }
    const result = await previewImport(
      { weddingId: session.weddingId, subjectId: session.subjectId },
      new Uint8Array(await file.arrayBuffer()),
    );
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[správa] náhled importu selhal", error instanceof Error ? error.name : "Error");
    return Response.json({ status: "error" }, { status: 500 });
  }
}
