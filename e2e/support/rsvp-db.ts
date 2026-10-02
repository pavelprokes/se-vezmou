import { Client } from "pg";
import { hashPin } from "../../src/auth/pin";
import { rateKey } from "../../src/auth/rate-limit";
import { databaseUrl, E2E_SECRETS } from "./env";
import { withDb } from "./db";

/**
 * Svatba pro e2e testy RSVP a PINu hostů (M8). Web páru zatím čte obsah z ukázkové fixtury
 * (`getPublicContent` patří M5), která zná jen adresu `klara-a-matej`; RSVP a PIN ale běží proti
 * skutečné databázi, takže testy zakládají jednu zveřejněnou svatbu s touto adresou přímo přes SQL
 * a před každým testem ji uvedou do výchozího stavu (`prepareWedding`).
 *
 * Jedna sdílená svatba vyžaduje, aby se testy nepřetahovaly o její stav: každý test drží výhradní
 * zámek (`pg_advisory_lock`) po celou dobu běhu, ať běží v kterémkoli projektu a procesu Playwrightu.
 */

export const TENANT_SLUG = "klara-a-matej";
export const WEDDING_ID = "5e2e0000-0000-4000-8000-000000000001";
const LOCK_KEY = 727_001;

export const EVENT_IDS = {
  obrad: "5e2e0000-0000-4000-8000-0000000000e1",
  hostina: "5e2e0000-0000-4000-8000-0000000000e2",
  soukroma: "5e2e0000-0000-4000-8000-0000000000e3",
} as const;
export type EventKey = keyof typeof EVENT_IDS;

/** Citlivá data svatby: unikátní řetězce, aby šlo ověřit, že bez PINu nejsou nikde v HTML ani v RSC. */
export const SENSITIVE = {
  account: "2501234567/2010",
  holder: "Klára E2E Ukázková",
  address: "Tajná zahrada 77, 252 01 Dobřichovice",
  directions: "Za zlatým vrátkem doleva",
};

/** IBAN českého účtu (kontrolní číslice podle ISO 13616). */
export function czIban(bank: string, prefix: string, account: string): string {
  const bban = `${bank}${prefix.padStart(6, "0")}${account.padStart(10, "0")}`;
  let remainder = 0;
  for (const digit of `${bban}123500`) remainder = (remainder * 10 + Number(digit)) % 97;
  return `CZ${String(98 - remainder).padStart(2, "0")}${bban}`;
}

export const GUEST_PIN = "482915";

export interface RsvpSetup {
  /** ISO čas otevření (null = otevřeno hned). */
  opensAt?: string | null;
  /** ISO čas uzavření (null = bez omezení). */
  closesAt?: string | null;
  allowUnlisted?: boolean;
  emailConfirmation?: boolean;
  /** Zapnuté vestavěné otázky (`plus_one`, `children`, `diet`, `lodging`, `transport`, `song`). */
  questions?: Partial<
    Record<"plus_one" | "children" | "diet" | "lodging" | "transport" | "song", boolean>
  >;
  /** Vlastní otázky páru. */
  custom?: {
    key: string;
    type: "text" | "choice" | "bool";
    label: { cs: string; en?: string };
    options?: { value: string; label: { cs: string; en?: string } }[];
    required?: boolean;
    event?: EventKey;
  }[];
  /** PIN hostů (null = vypnuto). */
  guestPin?: string | null;
}

export interface GuestSpec {
  name: string;
  child?: boolean;
  age?: number;
  /** Události, na které je host pozván (výchozí obřad i hostina). */
  events?: EventKey[];
}

export interface TenantWedding {
  ip: string;
  addHousehold(
    label: string,
    guests: GuestSpec[],
  ): Promise<{ householdId: string; guestIds: string[] }>;
  /** Pár uzavřel potvrzování (bez zásahu do hostů a lístků). */
  closeNow(): Promise<void>;
  /** Stav odpovědí v databázi pro kontrolu testů. */
  state(): Promise<RsvpState>;
}

export interface RsvpState {
  responses: {
    id: string;
    household_id: string | null;
    entered_by: string;
    contact_email: string | null;
    answers: Record<string, unknown>;
    last_edited_at: Date;
    submitted_at: Date;
  }[];
  people: {
    response_id: string;
    guest_id: string | null;
    person_name: string;
    is_plus_one: boolean;
    is_child: boolean;
    age: number | null;
    attendance: Record<string, boolean>;
    diet: string | null;
    allergies: string | null;
  }[];
}

/** Výhradní přístup ke sdílené svatbě po dobu testu; vrací funkci pro uvolnění. */
export async function lockWedding(): Promise<() => Promise<void>> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
  return async () => {
    try {
      await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
    } finally {
      await client.end();
    }
  };
}

async function ensureWedding(db: Client): Promise<void> {
  const exists = await db.query("select 1 from public.weddings where id = $1", [WEDDING_ID]);
  if (exists.rowCount) return;

  const versionId = "5e2e0000-0000-4000-8000-0000000000a1";
  const adminId = "5e2e0000-0000-4000-8000-0000000000b1";
  await db.query("begin");
  await db.query("set constraints all deferred");
  await db.query(
    "insert into public.weddings (id, partner_a_name, partner_b_name, starts_on) values ($1, 'Klára', 'Matěj', current_date + 200)",
    [WEDDING_ID],
  );
  await db.query(
    "insert into public.slug_registry (slug, state, wedding_id, reserved_until) values ($1, 'reserved', $2, now() + interval '30 days')",
    [TENANT_SLUG, WEDDING_ID],
  );
  await db.query("update public.weddings set slug = $1 where id = $2", [TENANT_SLUG, WEDDING_ID]);
  await db.query("insert into public.orders (wedding_id) values ($1)", [WEDDING_ID]);
  await db.query(
    "insert into public.wedding_admins (id, wedding_id, email) values ($1, $2, 'rsvp-spravce@example.test')",
    [adminId, WEDDING_ID],
  );
  await db.query(
    "insert into public.wedding_auth (wedding_id, backup_email) values ($1, 'rsvp-zaloha@example.test')",
    [WEDDING_ID],
  );
  await db.query(
    "insert into public.events (id, wedding_id, kind, title, starts_at, rsvp_enabled, position) values ($1, $4, 'ceremony', $5, now() + interval '200 days', true, 1), ($2, $4, 'reception', $6, now() + interval '200 days 3 hours', true, 2), ($3, $4, 'other', $7, now() + interval '201 days', false, 3)",
    [
      EVENT_IDS.obrad,
      EVENT_IDS.hostina,
      EVENT_IDS.soukroma,
      WEDDING_ID,
      JSON.stringify({ cs: "Svatební obřad", en: "Wedding ceremony" }),
      JSON.stringify({ cs: "Svatební hostina", en: "Wedding dinner" }),
      JSON.stringify({ cs: "Soukromá událost", en: "Private event" }),
    ],
  );
  await db.query(
    "insert into public.site_versions (id, wedding_id, version_no, kind, public_content, created_by) values ($1, $2, 1, 'publish', '{\"version\": 1}', $3)",
    [versionId, WEDDING_ID, adminId],
  );
  await db.query(
    "insert into public.site_version_sensitive (version_id, wedding_id, sensitive_content) values ($1, $2, $3)",
    [
      versionId,
      WEDDING_ID,
      JSON.stringify({
        venues: {
          v3: { address: SENSITIVE.address, directions: { cs: SENSITIVE.directions } },
        },
        gifts: {
          account: SENSITIVE.account,
          iban: czIban("2010", "000000", "2501234567"),
          holder: SENSITIVE.holder,
          paymentMessage: "Svatba Klára a Matěj",
        },
      }),
    ],
  );
  await db.query(
    "update public.weddings set published_version_id = $1, status = 'published' where id = $2",
    [versionId, WEDDING_ID],
  );
  await db.query("commit");
}

/** Klíče omezení, které testy mohou vyčerpat (HMAC jako v aplikaci). */
function limitKeys(ip: string): { rate: string[]; lockouts: string[] } {
  const secret = E2E_SECRETS.RATE_LIMIT_SECRET;
  const where = `${TENANT_SLUG}\0${ip}`;
  return {
    rate: [
      rateKey(secret, "rsvp-match", where),
      rateKey(secret, "rsvp-submit-ip", where),
      rateKey(secret, "rsvp-submit-wedding", TENANT_SLUG),
      rateKey(secret, "pin-guest-ip", where),
    ],
    lockouts: [
      rateKey(secret, "pin-guest-wedding-ip", where),
      rateKey(secret, "pin-guest-wedding", TENANT_SLUG),
    ],
  };
}

/** Uvede sdílenou svatbu do výchozího stavu podle `setup`; volat jen se zámkem z `lockWedding`. */
export async function prepareWedding(ip: string, setup: RsvpSetup = {}): Promise<TenantWedding> {
  const pinHash =
    setup.guestPin === undefined || setup.guestPin === null
      ? null
      : await hashPin(setup.guestPin, E2E_SECRETS.PIN_PEPPER);

  await withDb(async (db) => {
    await ensureWedding(db);
    await db.query("begin");
    await db.query("delete from public.rsvp_responses where wedding_id = $1", [WEDDING_ID]);
    await db.query("delete from public.households where wedding_id = $1", [WEDDING_ID]);
    await db.query("delete from public.rsvp_questions where wedding_id = $1", [WEDDING_ID]);
    await db.query("delete from public.rsvp_tickets where wedding_id = $1", [WEDDING_ID]);
    await db.query("delete from public.sessions where wedding_id = $1 and kind = 'guest_pin'", [
      WEDDING_ID,
    ]);
    await db.query("delete from public.email_log where wedding_id = $1", [WEDDING_ID]);
    const keys = limitKeys(ip);
    await db.query("delete from public.rate_limits where bucket_key = any($1)", [keys.rate]);
    await db.query("delete from public.lockouts where bucket_key = any($1)", [keys.lockouts]);

    await db.query(
      `insert into public.rsvp_settings (wedding_id, opens_at, closes_at, allow_unlisted, email_confirmation, enabled_questions)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (wedding_id) do update set opens_at = excluded.opens_at, closes_at = excluded.closes_at,
         allow_unlisted = excluded.allow_unlisted, email_confirmation = excluded.email_confirmation,
         enabled_questions = excluded.enabled_questions`,
      [
        WEDDING_ID,
        setup.opensAt ?? null,
        setup.closesAt ?? null,
        setup.allowUnlisted ?? false,
        setup.emailConfirmation ?? false,
        JSON.stringify(setup.questions ?? {}),
      ],
    );
    let position = 0;
    for (const question of setup.custom ?? []) {
      await db.query(
        `insert into public.rsvp_questions (wedding_id, key, type, label, options, required, event_id, position)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          WEDDING_ID,
          question.key,
          question.type,
          JSON.stringify(question.label),
          question.options ? JSON.stringify(question.options) : null,
          question.required ?? false,
          question.event ? EVENT_IDS[question.event] : null,
          position++,
        ],
      );
    }
    await db.query("update public.wedding_auth set guest_pin_hash = $2 where wedding_id = $1", [
      WEDDING_ID,
      pinHash,
    ]);
    await db.query("update public.weddings set guest_pin_enabled = $2 where id = $1", [
      WEDDING_ID,
      pinHash !== null,
    ]);
    await db.query("commit");
  });

  return {
    ip,
    async addHousehold(label, guests) {
      return withDb(async (db) => {
        const household = await db.query<{ id: string }>(
          "insert into public.households (wedding_id, label) values ($1, $2) returning id",
          [WEDDING_ID, label],
        );
        const householdId = household.rows[0].id;
        const guestIds: string[] = [];
        for (const guest of guests) {
          const row = await db.query<{ id: string }>(
            "insert into public.guests (wedding_id, household_id, display_name, is_child, age) values ($1, $2, $3, $4, $5) returning id",
            [WEDDING_ID, householdId, guest.name, guest.child ?? false, guest.age ?? null],
          );
          const guestId = row.rows[0].id;
          guestIds.push(guestId);
          for (const event of guest.events ?? ["obrad", "hostina"]) {
            await db.query(
              "insert into public.invitations (wedding_id, guest_id, event_id) values ($1, $2, $3)",
              [WEDDING_ID, guestId, EVENT_IDS[event]],
            );
          }
        }
        return { householdId, guestIds };
      });
    },
    async closeNow() {
      await withDb((db) =>
        db.query(
          "update public.rsvp_settings set closes_at = now() - interval '1 minute' where wedding_id = $1",
          [WEDDING_ID],
        ),
      );
    },
    async state() {
      return withDb(async (db) => {
        const responses = await db.query(
          "select id, household_id, entered_by, contact_email::text as contact_email, answers, last_edited_at, submitted_at from public.rsvp_responses where wedding_id = $1 order by submitted_at, id",
          [WEDDING_ID],
        );
        const people = await db.query(
          `select p.response_id, p.guest_id, p.person_name, p.is_plus_one, p.is_child, p.age,
                  coalesce((select jsonb_object_agg(a.event_id::text, a.attending)
                              from public.rsvp_attendance a where a.person_id = p.id), '{}'::jsonb) as attendance,
                  h.diet, h.allergies
             from public.rsvp_people p
             left join public.rsvp_health h on h.person_id = p.id
            where p.wedding_id = $1 order by p.created_at, p.id`,
          [WEDDING_ID],
        );
        return { responses: responses.rows, people: people.rows } as RsvpState;
      });
    },
  };
}

export async function guestSessions() {
  return withDb(async (db) => {
    const result = await db.query<{
      id: string;
      kind: string;
      subject_id: string | null;
      revoked_at: Date | null;
      token_hash: string;
      idle_expires_at: Date;
      absolute_expires_at: Date;
      last_seen_at: Date;
    }>(
      "select id, kind, subject_id, revoked_at, encode(token_hash, 'hex') as token_hash, idle_expires_at, absolute_expires_at, last_seen_at from public.sessions where wedding_id = $1 and kind = 'guest_pin' order by created_at",
      [WEDDING_ID],
    );
    return result.rows;
  });
}

/** Ukončí pauzu PINu hostů pro IP testu (simulace uplynutí času). */
export async function endGuestLockout(ip: string): Promise<void> {
  const keys = limitKeys(ip);
  await withDb((db) =>
    db.query(
      "update public.lockouts set locked_until = now() - interval '1 second' where bucket_key = any($1)",
      [keys.lockouts],
    ),
  );
}

export async function guestLockouts(ip: string) {
  const keys = limitKeys(ip);
  return withDb(async (db) => {
    const result = await db.query<{ bucket_key: string; level: number; failures: number }>(
      "select bucket_key, level, failures from public.lockouts where bucket_key = any($1)",
      [keys.lockouts],
    );
    return result.rows;
  });
}

export async function analyticsRows() {
  return withDb(async (db) => {
    const result = await db.query<Record<string, unknown>>(
      "select * from public.analytics_event where event = 'rsvp_completed' order by id",
    );
    return result.rows;
  });
}

export async function emailLogRows() {
  return withDb(async (db) => {
    const result = await db.query<Record<string, unknown>>(
      "select * from public.email_log where wedding_id = $1 order by created_at",
      [WEDDING_ID],
    );
    return result.rows;
  });
}
