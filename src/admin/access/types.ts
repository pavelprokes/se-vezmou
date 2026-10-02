import { z } from "zod";
import { locales } from "@/i18n/config";

/** Odpověď `admin_access_load` (obrazovka Přístup), ověřená hned za hranicí databáze. */
export const accessViewSchema = z.object({
  max_admins: z.number().int(),
  admins: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      added_at: z.string(),
      last_login_at: z.string().nullable(),
      is_me: z.boolean(),
    }),
  ),
  backup_email: z.string().nullable(),
  has_admin_pin: z.boolean(),
  has_guest_pin: z.boolean(),
  guest_pin_enabled: z.boolean(),
  status: z.string(),
  slug: z.string().nullable(),
  restore_days: z.number().int(),
  default_locale: z.enum(locales),
  timezone: z.string(),
  grants: z.array(
    z.object({
      id: z.string(),
      reason: z.string(),
      created_at: z.string(),
      expires_at: z.string(),
      revoked_at: z.string().nullable(),
      active: z.boolean(),
      by_me: z.boolean(),
    }),
  ),
  operator_views: z.array(
    z.object({
      id: z.number(),
      at: z.string(),
      action: z.string(),
      reason: z.string().nullable(),
    }),
  ),
});
export type AccessView = z.infer<typeof accessViewSchema>;

/** Odpovědi funkcí, které vracejí adresy k oznámení (`notify`). */
export const addAdminResultSchema = z.object({ id: z.string(), notify: z.array(z.string()) });
export const removeAdminResultSchema = z.object({
  removed: z.string(),
  notify: z.array(z.string()),
});
export const backupResultSchema = z.discriminatedUnion("changed", [
  z.object({ changed: z.literal(false) }),
  z.object({ changed: z.literal(true), old: z.string(), notify: z.array(z.string()) }),
]);
export const grantResultSchema = z.object({
  id: z.string(),
  expires_at: z.string(),
  notify: z.array(z.string()),
});
export const notifyResultSchema = z.object({ notify: z.array(z.string()) });
export const deleteResultSchema = z.object({
  purge_at: z.string().nullable(),
  notify: z.array(z.string()),
});

/** Souhlas s nahlédnutím: dovolené doby platnosti ve dnech (shodné s kontrolou v databázi). */
export const GRANT_DAYS = [1, 3, 7, 14, 30] as const;
export const GRANT_REASON = { min: 3, max: 500 } as const;
