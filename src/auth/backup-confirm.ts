import "server-only";
import { appHref } from "@/admin/paths";
import { requireEnv } from "@/env";
import type { Locale } from "@/i18n/config";
import { authBackupEmailConfirm } from "@/lib/db/rpc";
import { seal, unseal } from "./crypto";

/**
 * Potvrzení záložního e-mailu jeho vlastníkem: odkaz ve zprávě „někdo vás uvedl jako záložní e-mail“
 * nese zapečetěnou dvojici svatba + adresa. Odkaz sám nic nepotvrdí (skener schránky ho jen otevře),
 * potvrdí až odeslání formuláře. Databáze potvrdí jen shodnou aktuální adresu, takže starý odkaz po
 * změně záložního e-mailu nic nezpůsobí.
 */

const PURPOSE = "backup-confirm";
const TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const BACKUP_CONFIRM_PATH = "/potvrdit-email";

type Payload = { w: string; e: string; x: number };

export function backupConfirmUrl(
  origin: string,
  locale: Locale,
  weddingId: string,
  email: string,
  now = Date.now(),
): string {
  const payload: Payload = { w: weddingId, e: email, x: now + TTL_MS };
  const token = seal(requireEnv("AUTH_SECRET"), PURPOSE, payload);
  return `${origin}${appHref(BACKUP_CONFIRM_PATH, locale)}?t=${token}`;
}

export function openBackupConfirm(
  token: string,
  now = Date.now(),
): { weddingId: string; email: string } | null {
  const p = unseal<Payload>(requireEnv("AUTH_SECRET"), PURPOSE, token);
  if (!p || typeof p.w !== "string" || typeof p.e !== "string" || typeof p.x !== "number") {
    return null;
  }
  return p.x < now ? null : { weddingId: p.w, email: p.e };
}

/** `false` = odkaz neplatný, prošlý, adresa mezitím změněna, nebo už potvrzená. */
export async function confirmBackupEmail(token: string): Promise<boolean> {
  const opened = openBackupConfirm(token);
  return opened ? authBackupEmailConfirm(opened.weddingId, opened.email) : false;
}
