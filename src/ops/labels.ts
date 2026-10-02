import type { MessageKey } from "@/i18n/messages";
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

export const RETENTION_KEYS: Record<string, MessageKey> = {
  site_expiry: "ops.retention.kind.site_expiry",
  health_purge: "ops.retention.kind.health_purge",
  guest_purge: "ops.retention.kind.guest_purge",
  site_purge: "ops.retention.kind.site_purge",
};

export const PHASE_KEYS: Record<string, MessageKey> = {
  save_the_date: "ops.phase.save_the_date",
  rsvp_open: "ops.phase.rsvp_open",
  rsvp_closed: "ops.phase.rsvp_closed",
  wedding_day: "ops.phase.wedding_day",
  thanks: "ops.phase.thanks",
};

export const JOB_STATUS_KEYS: Record<string, MessageKey> = {
  running: "ops.jobs.status.running",
  ok: "ops.jobs.status.ok",
  partial: "ops.jobs.status.partial",
  failed: "ops.jobs.status.failed",
};

export const NOTICE_STATUS_KEYS: Record<string, MessageKey> = {
  pending: "ops.notices.pending",
  sending: "ops.notices.sending",
  sent: "ops.notices.sent",
  failed: "ops.notices.failed",
  skipped: "ops.notices.skipped",
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
