import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { HOSTS, pageUrl } from "../hosts";
import {
  generateBackupCodes,
  hashBackupCode,
  normalizeBackupCode,
} from "../../src/ops/backup-codes";
import { encryptTotpSecret } from "../../src/ops/mfa-secret";
import { generateTotpSecret, totpAt } from "../../src/ops/totp";
import { uniqueTag, withDb } from "./db";
import { E2E_SECRETS } from "./env";
import { readMails, waitForMail, type Mail } from "./mail";

/**
 * Pomocníci pro e2e testy provozní administrace (M9): zakládání operátorů a zakázek přímo v databázi
 * (jako vlastník, mimo RLS), přihlášení operátora přes e-mail a TOTP a čtení stavu (relace, audit).
 * Testy sdílejí jednu databázi a běží paralelně, proto každý test pracuje jen se svými daty
 * (značka `tag` v e-mailech, jménech a adresách) a nikdy nesahá na ukázkový web `klara-a-matej`.
 */

export const admin = (path = "/") => pageUrl(HOSTS.admin, path);

export const OPERATOR_CODE_SUBJECT = "Přihlašovací kód do provozní administrace";

export interface SeededOperator {
  id: string;
  email: string;
  role: "owner" | "support";
  /** Klíč TOTP (base32), když je faktor zapsaný. */
  secret: string | null;
  /** Čitelné záložní kódy (`ABCDE-FGHJK`), když je faktor zapsaný. */
  backupCodes: string[];
}

/** Založí operátora; s `enrolled` má už zapsaný druhý faktor a záložní kódy. */
export async function seedOperator(
  options: { role?: "owner" | "support"; enrolled?: boolean; tag?: string } = {},
): Promise<SeededOperator> {
  const tag = options.tag ?? uniqueTag();
  const operator: SeededOperator = {
    id: randomUUID(),
    email: `operator-${tag}@example.test`,
    role: options.role ?? "owner",
    secret: null,
    backupCodes: [],
  };
  await withDb(async (db) => {
    await db.query("insert into se_vezmou.operators (id, email, role) values ($1, $2, $3)", [
      operator.id,
      operator.email,
      operator.role,
    ]);
    if (options.enrolled) {
      operator.secret = generateTotpSecret();
      operator.backupCodes = generateBackupCodes();
      await db.query(
        "update se_vezmou.operators set totp_secret_enc = $2, totp_confirmed_at = now() where id = $1",
        [
          operator.id,
          encryptTotpSecret(E2E_SECRETS.OPERATOR_MFA_KEY, operator.id, operator.secret),
        ],
      );
      for (const code of operator.backupCodes) {
        await db.query(
          "insert into se_vezmou.operator_backup_codes (operator_id, code_hash) values ($1, $2)",
          [
            operator.id,
            hashBackupCode(E2E_SECRETS.OPERATOR_MFA_KEY, operator.id, normalizeBackupCode(code)!),
          ],
        );
      }
    }
  });
  return operator;
}

/** Kód TOTP pro daný časový krok (posun v krocích po 30 s od teď); server toleruje jeden krok na obě strany. */
export function totpFor(operator: SeededOperator, stepOffset = 0): string {
  return totpAt(operator.secret!, Date.now() + stepOffset * 30_000);
}

/**
 * Čerstvý kód TOTP pro přihlášení. Server každý časový krok přijme jednou; test, který se přihlašuje víckrát
 * během 30 sekund, proto před přihlášením zapomene poslední použitý krok (simulace uplynulého času).
 */
export async function freshTotp(operator: SeededOperator): Promise<string> {
  await withDb((db) =>
    db.query("update se_vezmou.operators set totp_last_step = null where id = $1", [operator.id]),
  );
  return totpFor(operator);
}

function operatorCodeMails(email: string): Mail[] {
  return readMails(email).filter((mail) => mail.subject === OPERATOR_CODE_SUBJECT);
}

/** Počká na další e-mail s přihlašovacím kódem pro operátora (po `before` už doručených) a vrátí kód. */
export async function waitForOperatorCode(email: string, before: number): Promise<string> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const mails = operatorCodeMails(email);
    if (mails.length > before) {
      const match = /^(\d{6})$/m.exec(mails[before].text);
      if (!match) throw new Error("V e-mailu operátora není šestimístný kód");
      return match[1];
    }
    if (Date.now() > deadline) throw new Error(`Kód pro ${email} nedorazil`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** E-mail, krok 1: vyžádá kód a počká na stránku s polem pro kód; vrací kód z e-mailu. */
export async function requestOperatorCode(page: Page, email: string): Promise<string> {
  const before = operatorCodeMails(email).length;
  await page.goto(admin("/prihlaseni"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Přihlášení do provozní administrace" }),
  ).toBeVisible();
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Poslat kód" }).click();
  await page.waitForURL(admin("/prihlaseni/kod"));
  return waitForOperatorCode(email, before);
}

/** Kroky 1 a 2: e-mail a kód z e-mailu; skončí na stránce druhého faktoru (nebo zápisu faktoru). */
export async function passFirstFactor(page: Page, operator: SeededOperator): Promise<void> {
  const code = await requestOperatorCode(page, operator.email);
  await page.getByLabel("Šestimístný kód").fill(code);
  await page.getByRole("button", { name: "Pokračovat" }).click();
  await page.waitForURL(admin(operator.secret ? "/prihlaseni/overeni" : "/prihlaseni/faktor"));
}

/** Celé přihlášení včetně TOTP; skončí na přehledu. */
export async function loginAsOperator(page: Page, operator: SeededOperator): Promise<void> {
  await passFirstFactor(page, operator);
  await page.getByLabel("Kód z aplikace nebo záložní kód").fill(await freshTotp(operator));
  await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
  await page.waitForURL(admin("/"));
  await expect(page.getByRole("heading", { level: 1, name: "Přehled" })).toBeVisible();
}

export async function operatorSessions(operatorId: string) {
  return withDb(async (db) => {
    const result = await db.query<{
      id: string;
      token_hash: string;
      aal2_verified_at: Date | null;
      revoked_at: Date | null;
      idle_seconds: number;
      idle_expires_at: Date;
      absolute_expires_at: Date;
      last_seen_at: Date;
      created_at: Date;
    }>(
      "select id, encode(token_hash, 'hex') as token_hash, aal2_verified_at, revoked_at, idle_seconds, idle_expires_at, absolute_expires_at, last_seen_at, created_at from se_vezmou.operator_sessions where operator_id = $1 order by created_at",
      [operatorId],
    );
    return result.rows;
  });
}

export async function auditRows(where: string, params: unknown[] = []) {
  return withDb(async (db) => {
    const result = await db.query<{
      id: string;
      at: Date;
      actor_type: string;
      actor_id: string | null;
      wedding_id: string | null;
      action: string;
      target_type: string | null;
      target_id: string | null;
      reason: string | null;
      meta: Record<string, unknown>;
    }>(`select * from se_vezmou.audit_log where ${where} order by id`, params);
    return result.rows;
  });
}

export interface OpsWedding {
  tag: string;
  weddingId: string;
  adminId: string;
  slug: string;
  adminEmail: string;
  partnerA: string;
  partnerB: string;
  /** Jména na obrazovce (`Alžběta a Ctibor`) pro hledání odkazu v seznamu. */
  names: string;
}

export interface OpsWeddingOptions {
  tag?: string;
  status?: "draft" | "published" | "blocked" | "archived" | "deleted";
  template?: "editorial" | "eukalyptus" | "chateau" | "modern";
  locales?: ("cs" | "en")[];
  startsOn?: string | null;
  /** Hosté (domácnost a jména): jen ve zvláštním testu nahlížení. */
  guests?: string[];
  /** Konec provozu (`orders.service_ends_at`). */
  serviceEndsAt?: string | null;
}

/**
 * Založí zakázku pro provozní administraci: svatba, adresa, zakázka, správce, záložní e-mail a podle stavu
 * i zveřejněná verze. Jména páru nesou značku (`Alžběta<tag>`), aby se zakázka dala dohledat jen svým testem.
 */
export async function seedOpsWedding(options: OpsWeddingOptions = {}): Promise<OpsWedding> {
  const tag = options.tag ?? uniqueTag();
  const status = options.status ?? "published";
  const wedding: OpsWedding = {
    tag,
    weddingId: randomUUID(),
    adminId: randomUUID(),
    slug: `ops-${tag}`,
    adminEmail: `spravce-${tag}@example.test`,
    partnerA: `Alžběta${tag}`,
    partnerB: `Ctibor${tag}`,
    names: `Alžběta${tag} a Ctibor${tag}`,
  };
  const locales = options.locales ?? ["cs"];
  const published = status === "published" || status === "blocked" || status === "archived";

  await withDb(async (db) => {
    await db.query("begin");
    await db.query("set constraints all deferred");
    await db.query(
      `insert into se_vezmou.weddings (id, partner_a_name, partner_b_name, starts_on, default_locale, locales, template)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        wedding.weddingId,
        wedding.partnerA,
        wedding.partnerB,
        options.startsOn === undefined ? "2031-06-12" : options.startsOn,
        locales[0],
        locales,
        options.template ?? "editorial",
      ],
    );
    await db.query(
      "insert into se_vezmou.slug_registry (slug, state, wedding_id, reserved_until) values ($1, 'reserved', $2, now() + interval '30 days')",
      [wedding.slug, wedding.weddingId],
    );
    await db.query("update se_vezmou.weddings set slug = $1 where id = $2", [
      wedding.slug,
      wedding.weddingId,
    ]);
    await db.query("insert into se_vezmou.orders (wedding_id, service_ends_at) values ($1, $2)", [
      wedding.weddingId,
      options.serviceEndsAt ?? null,
    ]);
    await db.query(
      "insert into se_vezmou.wedding_admins (id, wedding_id, email) values ($1, $2, $3)",
      [wedding.adminId, wedding.weddingId, wedding.adminEmail],
    );
    await db.query(
      "insert into se_vezmou.wedding_auth (wedding_id, backup_email) values ($1, $2)",
      [wedding.weddingId, `zaloha-${tag}@example.test`],
    );
    if (published) {
      const versionId = randomUUID();
      await db.query(
        "insert into se_vezmou.site_versions (id, wedding_id, version_no, kind, public_content, created_by) values ($1, $2, 1, 'publish', '{}', $3)",
        [versionId, wedding.weddingId, wedding.adminId],
      );
      await db.query(
        "update se_vezmou.weddings set status = 'published', published_version_id = $2 where id = $1",
        [wedding.weddingId, versionId],
      );
    }
    for (const [index, name] of (options.guests ?? []).entries()) {
      const household = randomUUID();
      await db.query(
        "insert into se_vezmou.households (id, wedding_id, label) values ($1, $2, $3)",
        [household, wedding.weddingId, `Domácnost ${index + 1}`],
      );
      await db.query(
        "insert into se_vezmou.guests (wedding_id, household_id, display_name) values ($1, $2, $3)",
        [wedding.weddingId, household, name],
      );
    }
    await db.query("commit");
    if (status === "blocked" || status === "archived" || status === "deleted") {
      await db.query("update se_vezmou.weddings set status = $2 where id = $1", [
        wedding.weddingId,
        status,
      ]);
    }
  });
  return wedding;
}

/** Mnoho jednoduchých zakázek najednou (stránkování seznamu); jména nesou značku `base`. */
export async function seedManyWeddings(base: string, count: number): Promise<void> {
  await withDb((db) =>
    db.query(
      `insert into se_vezmou.weddings (partner_a_name, partner_b_name)
       select 'Hromada' || $1::text, 'Číslo' || g from generate_series(1, $2::int) g`,
      [base, count],
    ),
  );
}

/** Souhlas páru s nahlédnutím do údajů hostů (platný `hours` hodin), jako ho zapíše správce v M7. */
export async function grantGuestAccess(wedding: OpsWedding, hours = 24): Promise<void> {
  await withDb((db) =>
    db.query(
      "insert into se_vezmou.data_access_grants (wedding_id, granted_by_admin_id, reason, expires_at) values ($1, $2, 'Souhlas páru e2e', now() + make_interval(hours => $3))",
      [wedding.weddingId, wedding.adminId, hours],
    ),
  );
}

export { waitForMail };
