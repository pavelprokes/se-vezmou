"use server";

import { guarded } from "@/admin/guard";
import {
  giftCommand,
  saveGift,
  type GiftActionResult,
  type GiftCommand,
} from "@/admin/gifts/server";
import type { Guarded } from "@/admin/site/action-types";

/** Server Actions seznamu darů: kontrola původu a relace (`guarded`), vstup se ověřuje znovu. */

export async function saveGiftAction(
  id: string | null,
  input: unknown,
): Promise<Guarded<GiftActionResult>> {
  return guarded("uložení daru", (session) => saveGift(session, id, input));
}

export async function giftCommandAction(
  id: string,
  command: GiftCommand,
): Promise<Guarded<GiftActionResult>> {
  if (!["delete", "release", "up", "down"].includes(command)) return { status: "error" };
  return guarded("úprava daru", (session) => giftCommand(session, id, command));
}
