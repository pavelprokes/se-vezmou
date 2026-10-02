import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Tajné hodnoty a cesty testovacího prostředí (jen e2e; nic z toho nejde do produkce).
 * Testy je znají, aby mohly spočítat klíče omezení počtu požadavků a hash e-mailů jako aplikace
 * a ověřit, že databáze neobsahuje čitelné údaje.
 */
export const E2E_SECRETS = {
  AUTH_SECRET: "e2e-auth-secret-e2e-auth-secret-0000001",
  RATE_LIMIT_SECRET: "e2e-rate-secret-e2e-rate-secret-000002",
  PIN_PEPPER: "e2e-pin-pepper-e2e-pin-pepper-0000003",
} as const;

/** Adresář s e-maily, které aplikace v testech místo odeslání zapisuje (EMAIL_TRANSPORT=outbox). */
export function outboxDir(): string {
  return process.env.E2E_OUTBOX_DIR ?? join(tmpdir(), "sevezmou-e2e-outbox");
}

export function databaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error(
      "Chybí E2E_DATABASE_URL. E2E testy přihlášení potřebují databázi: spusťte je přes " +
        "`npm run test:e2e` / `npm run test:a11y` (scripts/e2e-db.sh ji připraví).",
    );
  }
  return url;
}

/**
 * Adresa databáze pro aplikaci: role `se_vezmou_app` (bez práv, `set local role` v každém volání).
 * `databaseUrl()` je naopak vlastník schématu a používají ho jen testovací pomocníci k zakládání dat.
 */
export function appDatabaseUrl(): string {
  const url = process.env.E2E_APP_DATABASE_URL;
  if (!url) {
    throw new Error(
      "Chybí E2E_APP_DATABASE_URL. Spusťte testy přes `npm run test:e2e` / `npm run test:a11y` (scripts/e2e-db.sh).",
    );
  }
  return url;
}
