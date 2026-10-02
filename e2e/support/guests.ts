import { randomUUID } from "node:crypto";
import { seedManagedSite, type ManagedSite, type SeedOptions } from "./admin";
import { withDb } from "./db";

/**
 * Pomocníci e2e správy hostů a přístupu (M7b): hosté a domácnosti přímo v databázi (správa je jinak
 * zapisuje přes obrazovky, které se testují zvlášť) a čtení stavu pro ověření výsledku.
 */

export interface SeedHousehold {
  label: string;
  guests: { name: string; child?: boolean; age?: number }[];
  /** Na které události jsou pozváni (všichni hosté domácnosti); výchozí obě. */
  events?: ("ceremony" | "reception")[];
}

/**
 * Zveřejněný web z `seedManagedSite` má jen zveřejněný snímek; pracovní kopii (stránku a události) si
 * správa za běhu naplní až při prvním otevření editoru. Obrazovky hostů čtou události z pracovní kopie
 * (pozvání se na ně vážou), proto se tu zapíše stejná stránka a události jako ve snímku.
 */
export async function ensureEvents(weddingId: string): Promise<void> {
  await withDb(async (db) => {
    const existing = await db.query(
      "select 1 from se_vezmou.events where wedding_id = $1 limit 1",
      [weddingId],
    );
    if (existing.rows.length > 0) return;
    await db.query("begin");
    const page = await db.query<{ id: string }>(
      `insert into se_vezmou.pages (wedding_id, path, title) values ($1, '', '{"cs": "Domů"}')
       on conflict (wedding_id, path) do update set path = excluded.path returning id`,
      [weddingId],
    );
    await db.query(
      `insert into se_vezmou.events (wedding_id, page_id, kind, title, starts_at, rsvp_enabled, position)
       values ($1, $2, 'ceremony', '{"cs": "Svatební obřad", "en": "Wedding ceremony"}', '2027-06-19T14:00:00+02:00', true, 1),
              ($1, $2, 'reception', '{"cs": "Hostina", "en": "Reception"}', '2027-06-19T16:30:00+02:00', true, 2)`,
      [weddingId, page.rows[0].id],
    );
    await db.query("commit");
  });
}

/** Zveřejněný web se správcem a pracovní kopií událostí (viz `ensureEvents`). */
export async function seedSite(options: SeedOptions = {}): Promise<ManagedSite> {
  const site = await seedManagedSite(options);
  await ensureEvents(site.weddingId);
  return site;
}

export async function eventIds(
  weddingId: string,
): Promise<{ ceremony: string; reception: string }> {
  return withDb(async (db) => {
    const result = await db.query<{ id: string; kind: string }>(
      "select id, kind from se_vezmou.events where wedding_id = $1",
      [weddingId],
    );
    const find = (kind: string) => {
      const row = result.rows.find((r) => r.kind === kind);
      if (!row) throw new Error(`Svatba nemá událost ${kind}`);
      return row.id;
    };
    return { ceremony: find("ceremony"), reception: find("reception") };
  });
}

/** Založí domácnosti s hosty a pozvánkami; vrací identifikátory domácností v pořadí zadání. */
export async function seedHouseholds(
  weddingId: string,
  households: SeedHousehold[],
): Promise<string[]> {
  const events = await eventIds(weddingId);
  const ids: string[] = [];
  await withDb(async (db) => {
    await db.query("begin");
    for (const household of households) {
      const id = randomUUID();
      ids.push(id);
      await db.query(
        "insert into se_vezmou.households (id, wedding_id, label) values ($1, $2, $3)",
        [id, weddingId, household.label],
      );
      for (const guest of household.guests) {
        const guestId = randomUUID();
        await db.query(
          `insert into se_vezmou.guests (id, wedding_id, household_id, display_name, is_child, age, source)
           values ($1, $2, $3, $4, $5, $6, 'manual')`,
          [guestId, weddingId, id, guest.name, guest.child ?? false, guest.age ?? null],
        );
        for (const kind of household.events ?? ["ceremony", "reception"]) {
          await db.query(
            "insert into se_vezmou.invitations (wedding_id, guest_id, event_id) values ($1, $2, $3)",
            [weddingId, guestId, events[kind]],
          );
        }
      }
    }
    await db.query("commit");
  });
  return ids;
}

export async function guestRows(weddingId: string) {
  return withDb(async (db) => {
    const result = await db.query<{
      display_name: string;
      is_child: boolean;
      age: number | null;
      source: string;
      label: string;
      invitations: number;
    }>(
      `select g.display_name, g.is_child, g.age, g.source, h.label,
              (select count(*)::int from se_vezmou.invitations i where i.guest_id = g.id) as invitations
         from se_vezmou.guests g join se_vezmou.households h on h.id = g.household_id
        where g.wedding_id = $1 order by g.display_name`,
      [weddingId],
    );
    return result.rows;
  });
}

export async function responseRows(weddingId: string) {
  return withDb(async (db) => {
    const result = await db.query<{
      entered_by: string;
      answers: Record<string, unknown>;
      attending: number;
      declined: number;
    }>(
      `select r.entered_by, r.answers,
              (select count(*)::int from se_vezmou.rsvp_attendance a join se_vezmou.rsvp_people p on p.id = a.person_id
                where p.response_id = r.id and a.attending) as attending,
              (select count(*)::int from se_vezmou.rsvp_attendance a join se_vezmou.rsvp_people p on p.id = a.person_id
                where p.response_id = r.id and not a.attending) as declined
         from se_vezmou.rsvp_responses r where r.wedding_id = $1`,
      [weddingId],
    );
    return result.rows;
  });
}

export async function rsvpSettingsRow(weddingId: string) {
  return withDb(async (db) => {
    const settings = await db.query<{
      opens_at: Date | null;
      closes_at: Date | null;
      allow_unlisted: boolean;
      email_confirmation: boolean;
      enabled_questions: Record<string, boolean>;
    }>("select * from se_vezmou.rsvp_settings where wedding_id = $1", [weddingId]);
    const questions = await db.query<{
      key: string;
      type: string;
      required: boolean;
      enabled: boolean;
    }>(
      "select key, type, required, enabled from se_vezmou.rsvp_questions where wedding_id = $1 order by position",
      [weddingId],
    );
    return { settings: settings.rows[0], questions: questions.rows };
  });
}

export async function activeAdminEmails(weddingId: string): Promise<string[]> {
  return withDb(async (db) => {
    const result = await db.query<{ email: string }>(
      "select email::text from se_vezmou.wedding_admins where wedding_id = $1 and removed_at is null order by added_at",
      [weddingId],
    );
    return result.rows.map((row) => row.email);
  });
}

export async function backupEmail(weddingId: string): Promise<string> {
  return withDb(async (db) => {
    const result = await db.query<{ email: string }>(
      "select backup_email::text as email from se_vezmou.wedding_auth where wedding_id = $1",
      [weddingId],
    );
    return result.rows[0].email;
  });
}

export async function grantRows(weddingId: string) {
  return withDb(async (db) => {
    const result = await db.query<{
      reason: string;
      active: boolean;
      revoked_at: Date | null;
    }>(
      `select reason, revoked_at is null and expires_at > now() as active, revoked_at
         from se_vezmou.data_access_grants where wedding_id = $1 order by created_at`,
      [weddingId],
    );
    return result.rows;
  });
}

export async function guestPinState(weddingId: string) {
  return withDb(async (db) => {
    const result = await db.query<{ enabled: boolean; has_pin: boolean; has_admin_pin: boolean }>(
      `select w.guest_pin_enabled as enabled, wa.guest_pin_hash is not null as has_pin,
              wa.admin_pin_hash is not null as has_admin_pin
         from se_vezmou.weddings w join se_vezmou.wedding_auth wa on wa.wedding_id = w.id
        where w.id = $1`,
      [weddingId],
    );
    return result.rows[0];
  });
}

export async function sessionState(weddingId: string, subjectId: string) {
  return withDb(async (db) => {
    const result = await db.query<{ revoked: boolean }>(
      "select revoked_at is not null as revoked from se_vezmou.sessions where wedding_id = $1 and subject_id = $2",
      [weddingId, subjectId],
    );
    return result.rows;
  });
}
