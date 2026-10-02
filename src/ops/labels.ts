import type { MessageKey } from "@/i18n/messages";
import type { RetentionKind } from "@/lib/db/rpc-ops";
import type { WeddingStatus } from "@/lib/db/types";

/** Klíče popisků výčtů (stavy, šablony, jazyky, události, druhy lhůt); v jednom souboru, aby je sdílely stránky. */

export const STATUS_KEYS: Record<WeddingStatus, MessageKey> = {
  draft: "ops.status.draft",
  pending_payment: "ops.status.pending_payment",
  published: "ops.status.published",
  archived: "ops.status.archived",
  deleted: "ops.status.deleted",
  blocked: "ops.status.blocked",
};

export const TEMPLATE_KEYS: Record<string, MessageKey> = {
  editorial: "ops.template.editorial",
  eukalyptus: "ops.template.eukalyptus",
  chateau: "ops.template.chateau",
  modern: "ops.template.modern",
};

export const LOCALE_KEYS: Record<string, MessageKey> = {
  cs: "ops.locale.cs",
  en: "ops.locale.en",
};

export const EVENT_KEYS: Record<string, MessageKey> = {
  wizard_started: "ops.event.wizard_started",
  wizard_step_completed: "ops.event.wizard_step_completed",
  site_published: "ops.event.site_published",
  rsvp_completed: "ops.event.rsvp_completed",
};

export const SLUG_STATE_KEYS: Record<string, MessageKey> = {
  reserved: "ops.slugState.reserved",
  active: "ops.slugState.active",
  retired: "ops.slugState.retired",
  reserved_word: "ops.slugState.reserved_word",
};

export const ACTOR_KEYS: Record<string, MessageKey> = {
  operator: "ops.actor.operator",
  system: "ops.actor.system",
  admin: "ops.actor.admin",
  guest: "ops.actor.guest",
};

export const RETENTION_KEYS: Record<RetentionKind, MessageKey> = {
  service: "ops.retention.kind.service",
  health: "ops.retention.kind.health",
  guests: "ops.retention.kind.guests",
  purge: "ops.retention.kind.purge",
};

/** Popisek hodnoty výčtu; neznámá hodnota se zobrazí tak, jak je (nikdy nespadne). */
export function label(
  t: (key: MessageKey) => string,
  map: Record<string, MessageKey>,
  value: string,
): string {
  const key = map[value];
  return key ? t(key) : value;
}
