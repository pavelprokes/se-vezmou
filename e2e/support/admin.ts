import { randomUUID } from "node:crypto";
import type { BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import {
  editorDocSchema,
  normalizeBlocks,
  docToPublic,
  type EditorBlock,
} from "../../src/admin/site/doc";
import { generateToken, hashToken } from "../../src/auth/crypto";
import { hashPin } from "../../src/auth/pin";
import { HOSTS, pageUrl } from "../hosts";
import { uniqueTag, withDb } from "./db";
import { E2E_SECRETS } from "./env";

/**
 * Pomocníci pro e2e správy webu (M7a): zveřejněný web se správcem a relací v cookie, bez průchodu
 * přihlášením (to pokrývá `auth.e2e.ts`). Web vzniká přímo v databázi jako zveřejněná verze 1;
 * pracovní kopii při prvním otevření editoru naplní server ze zveřejněné verze.
 */

export const GUEST_PIN = "482915";

export interface ManagedSite {
  tag: string;
  weddingId: string;
  adminId: string;
  slug: string;
  adminEmail: string;
  names: [string, string];
  /** Adresa webu páru (kořen, česky). */
  url: string;
  /** Přidá do prohlížeče cookie relace tohoto správce. */
  login(context: BrowserContext): Promise<void>;
}

export interface SeedOptions {
  tag?: string;
  names?: [string, string];
  locales?: ("cs" | "en")[];
  template?: "editorial" | "eukalyptus" | "chateau" | "modern";
  palette?: string;
  /** PIN hostů (zapne ho a uloží hash); bez něj je PIN hostů vypnutý. */
  guestPin?: string | null;
  /** Správce se stejným e-mailem u více svateb (výběr svatby). */
  adminEmail?: string;
  /** Stálá fáze webu (`phase_override`), nezávislá na dnešním datu. */
  phase?: "save_the_date" | "rsvp_open" | "thanks";
  /** Upraví dokument před zveřejněním (např. zapnout další bloky). */
  tweak?: (blocks: EditorBlock[]) => EditorBlock[];
}

export const tenantUrl = (slug: string, path = "/") => pageUrl(`${slug}.localhost`, path);
export const appUrl = (path = "/") => pageUrl(HOSTS.app, path);

export async function seedManagedSite(options: SeedOptions = {}): Promise<ManagedSite> {
  const tag = options.tag ?? uniqueTag();
  const slug = `e2e-sp-${tag}`;
  const names = options.names ?? ["Klára", "Matěj"];
  const adminEmail = options.adminEmail ?? `spravce-${slug}@example.test`;
  const weddingId = randomUUID();
  const adminId = randomUUID();
  const versionId = randomUUID();
  const venueId = randomUUID();
  const ids = { ceremony: randomUUID(), reception: randomUUID() };
  const locales = options.locales ?? ["cs", "en"];
  const template = options.template ?? "chateau";
  const palette = options.palette ?? "slonovina";

  const doc = editorDocSchema.parse({
    wedding: {
      partnerA: names[0],
      partnerB: names[1],
      startsOn: "2027-06-19",
      endsOn: null,
      timezone: "Europe/Prague",
      locales,
      defaultLocale: "cs",
      template,
      palette,
    },
    venues: [
      {
        id: venueId,
        name: { cs: "Zámecká kaple", en: "Castle chapel" },
        address: "Zámecká 1, Dobřichovice",
        isPrivate: false,
        directions: null,
        mapUrl: null,
      },
    ],
    events: [
      {
        id: ids.ceremony,
        kind: "ceremony",
        title: { cs: "Svatební obřad", en: "Wedding ceremony" },
        description: null,
        startsAt: "2027-06-19T14:00:00+02:00",
        endsAt: null,
        venueId,
        rsvpEnabled: true,
      },
      {
        id: ids.reception,
        kind: "reception",
        title: { cs: "Hostina", en: "Reception" },
        description: null,
        startsAt: "2027-06-19T16:30:00+02:00",
        endsAt: null,
        venueId,
        rsvpEnabled: true,
      },
    ],
    blocks: [],
  });
  const enabled = new Set(["hero", "program", "venue", "dresscode", "rsvp"]);
  let blocks = normalizeBlocks(doc.blocks).map((block): EditorBlock => {
    if (!enabled.has(block.type)) return block;
    const data =
      block.type === "venue"
        ? { ...block.data, venueIds: [venueId] }
        : block.type === "dresscode"
          ? { text: { cs: "Slavnostní, bez bílé." } }
          : block.data;
    return { ...block, enabled: true, data } as EditorBlock;
  });
  if (options.tweak) blocks = options.tweak(blocks);
  const built = docToPublic({ ...doc, blocks }, { slug, phase: options.phase ?? "rsvp_open" });
  if (!built) throw new Error("Snímek ukázkového webu nejde sestavit");

  const guestHash = options.guestPin
    ? await hashPin(options.guestPin, E2E_SECRETS.PIN_PEPPER)
    : null;
  const adminPin = null;

  await withDb(async (db) => {
    await db.query("begin");
    await db.query("set constraints all deferred");
    await db.query(
      `insert into se_vezmou.weddings (id, partner_a_name, partner_b_name, starts_on, default_locale, locales, template, palette, guest_pin_enabled)
       values ($1, $2, $3, '2027-06-19', 'cs', $4, $5, $6, $7)`,
      [weddingId, names[0], names[1], locales, template, palette, Boolean(options.guestPin)],
    );
    await db.query(
      "insert into se_vezmou.slug_registry (slug, state, wedding_id, reserved_until) values ($1, 'reserved', $2, now() + interval '30 days')",
      [slug, weddingId],
    );
    await db.query("update se_vezmou.weddings set slug = $1 where id = $2", [slug, weddingId]);
    await db.query("insert into se_vezmou.orders (wedding_id) values ($1)", [weddingId]);
    await db.query(
      "insert into se_vezmou.wedding_admins (id, wedding_id, email) values ($1, $2, $3)",
      [adminId, weddingId, adminEmail],
    );
    await db.query(
      "insert into se_vezmou.wedding_auth (wedding_id, backup_email, admin_pin_hash, guest_pin_hash) values ($1, $2, $3, $4)",
      [weddingId, `zaloha-${slug}@example.test`, adminPin, guestHash],
    );
    await db.query(
      "insert into se_vezmou.rsvp_settings (wedding_id, enabled_questions) values ($1, '{}')",
      [weddingId],
    );
    await db.query(
      "insert into se_vezmou.site_versions (id, wedding_id, version_no, kind, public_content, created_by) values ($1, $2, 1, 'publish', $3, $4)",
      [versionId, weddingId, JSON.stringify(built.content), adminId],
    );
    await db.query(
      "insert into se_vezmou.site_version_sensitive (version_id, wedding_id, sensitive_content) values ($1, $2, $3)",
      [versionId, weddingId, JSON.stringify(built.sensitive)],
    );
    await db.query(
      "update se_vezmou.weddings set status = 'published', published_version_id = $2, phase_override = $3 where id = $1",
      [weddingId, versionId, options.phase ?? "rsvp_open"],
    );
    await db.query("commit");
  });

  return {
    tag,
    weddingId,
    adminId,
    slug,
    adminEmail,
    names,
    url: tenantUrl(slug),
    async login(context) {
      await loginAs(context, weddingId, adminId);
    },
  };
}

/** Relace správce přímo v databázi + cookie `sv_admin` (lokálně bez prefixu `__Host-`). */
export async function loginAs(
  context: BrowserContext,
  weddingId: string,
  adminId: string,
): Promise<void> {
  const token = generateToken();
  await withDb((db) =>
    db.query(
      `insert into se_vezmou.sessions (token_hash, kind, wedding_id, subject_id, idle_seconds, idle_expires_at, absolute_expires_at)
       values ($1, 'admin', $2, $3, 1209600, now() + interval '14 days', now() + interval '60 days')`,
      [hashToken(token), weddingId, adminId],
    ),
  );
  await context.addCookies([
    {
      name: "sv_admin",
      value: token,
      domain: HOSTS.app,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

export async function setPhase(weddingId: string, phase: string): Promise<void> {
  await withDb((db) =>
    db.query("update se_vezmou.weddings set phase_override = $2 where id = $1", [weddingId, phase]),
  );
}

export async function versionsOf(weddingId: string) {
  return withDb(async (db) => {
    const result = await db.query<{ version_no: number; kind: string; note: string | null }>(
      "select version_no, kind, note from se_vezmou.site_versions where wedding_id = $1 order by version_no",
      [weddingId],
    );
    return result.rows;
  });
}

export async function weddingRow(weddingId: string) {
  return withDb(async (db) => {
    const result = await db.query<{
      status: string;
      template: string;
      site_rev: number;
      quick_notice_enabled: boolean;
      quick_notice: Record<string, string> | null;
    }>(
      "select status, template, site_rev, quick_notice_enabled, quick_notice from se_vezmou.weddings where id = $1",
      [weddingId],
    );
    return result.rows[0];
  });
}

export async function auditActions(weddingId: string): Promise<string[]> {
  return withDb(async (db) => {
    const result = await db.query<{ action: string }>(
      "select action from se_vezmou.audit_log where wedding_id = $1 order by id",
      [weddingId],
    );
    return result.rows.map((row) => row.action);
  });
}

// --- obrazovka editoru ----------------------------------------------------------------------------

/** Otevře editor a počká na vykreslení (nadpis, stav webu, bloky). */
export async function openEditor(page: Page, path = "/web"): Promise<void> {
  await page.goto(appUrl(path));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("site-status")).toBeVisible();
}

/** Blok v seznamu sekcí. */
export const block = (page: Page, type: string) => page.getByTestId(`block-${type}`);

/** Rozbalí formulář sekce (je-li sbalený) a vrátí její blok. */
export async function openBlock(page: Page, type: string, name: string) {
  const item = block(page, type);
  const toggle = item.getByRole("button", { name: `Upravit sekci ${name}` });
  if (await toggle.count()) await toggle.click();
  await expect(item.getByRole("button", { name: `Sbalit sekci ${name}` })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  return item;
}

/**
 * Počká, až se změna uloží na server. Průběžné ukládání má čekání 0,7 s; text s časem ("(14:32)")
 * se objeví až po skutečném uložení (před ním je text bez času), takže test nikdy nepokračuje dřív,
 * než server odpověděl.
 */
export async function expectSaved(page: Page): Promise<void> {
  await expect(page.getByTestId("save-state")).toContainText(
    /Všechny změny jsou uložené \(\d{1,2}:\d{2}\)/,
  );
}

/** Pořadí sekcí v seznamu (druhy bloků shora dolů). */
export async function blockOrder(page: Page): Promise<string[]> {
  const ids = await page
    .locator('li[data-testid^="block-"]')
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-testid") ?? ""));
  return ids.map((id) => id.replace(/^block-/, ""));
}
