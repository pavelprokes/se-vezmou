"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { appHref } from "@/admin/paths";
import { assertSameOrigin, getUiLocale } from "@/auth/request";
import { getSession, startAdminSession } from "@/auth/session";
import { adminMyWeddings } from "@/lib/db/admin-site";

/** Stav přepnutí svatby, který formulář zobrazí (úspěch přesměruje). */
export type SwitchState = { error: "failed" } | null;

const weddingSchema = z.uuid();

/**
 * Přepnutí na jinou svatbu téhož správce (stejný e-mail). Nová relace vzniká jen pro svatbu, kterou
 * databáze pro správce z aktuální relace vrátí (`admin_my_weddings`); identifikátor od klienta se
 * s tím porovná, nikdy se mu nevěří. Stará relace se odvolá (fixace relace).
 */
export async function switchWeddingAction(
  _state: SwitchState,
  formData: FormData,
): Promise<SwitchState> {
  try {
    await assertSameOrigin();
  } catch {
    return { error: "failed" };
  }
  const parsed = weddingSchema.safeParse(formData.get("weddingId"));
  if (!parsed.success) return { error: "failed" };

  const locale = await getUiLocale();
  try {
    const session = await getSession();
    if (!session) redirect("/prihlaseni");
    const mine = await adminMyWeddings(session);
    const target = mine.find((wedding) => wedding.weddingId === parsed.data);
    if (!target) return { error: "failed" };
    if (!target.isCurrent) await startAdminSession(target.weddingId, target.adminId);
  } catch (error) {
    // redirect() je výjimka řízení toku a musí projít dál
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    if (typeof error === "object" && error !== null && "digest" in error) throw error;
    console.error(
      "[správa] přepnutí svatby selhalo",
      error instanceof Error ? error.name : "Error",
    );
    return { error: "failed" };
  }
  redirect(appHref("/", locale));
}
