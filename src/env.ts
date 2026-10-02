import { z } from "zod";

/** Tajné hodnoty musí mít dost entropie (HMAC, AES, JWT); kratší hodnotu aplikace odmítne při startu. */
const secret = z.string().min(32);

const schema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url().default("https://se-vezmou.cz"),
  // Adresa průvodce a správy (`app.`). Úvodní stránka na ni odkazuje a předává jména párů.
  NEXT_PUBLIC_APP_URL: z.url().default("https://app.se-vezmou.cz"),

  // Databáze (docs/adr/0011): jen server, přímé spojení `pg`. Prohlížeč s databází nemluví vůbec;
  // žádné NEXT_PUBLIC_SUPABASE_*, žádný anon klíč, žádný service role klíč, žádný PostgREST.
  /** Adresa poolu Supabase (transaction mode, port 6543) pro roli se_vezmou_app: postgresql://… */
  DATABASE_URL: z.string().min(1).optional(),
  /** Záložně jen pokud začíná postgres:// nebo postgresql:// (jinak se ignoruje), src/lib/db/pool.ts. */
  SUPABASE_URL: z.string().min(1).optional(),
  /** Volitelně PEM kořenové CA Supabase: zapne ověřování certifikátu databáze (src/lib/db/pool.ts). */
  DATABASE_CA_CERT: z.string().min(1).optional(),

  // Přihlášení (M4)
  /** Klíč pro HMAC e-mailů a kódů v databázi a pro šifrování odkazů a rozpracovaného přihlášení. */
  AUTH_SECRET: secret.optional(),
  /** Klíč pro HMAC klíčů omezení počtu požadavků (IP, e-mail, slug), docs/adr/0010. */
  RATE_LIMIT_SECRET: secret.optional(),
  /** Pepper pro PINy: PIN se před argon2id zpracuje HMAC, docs/security-privacy.md kap. 1.2. */
  PIN_PEPPER: secret.optional(),

  // Plánované úlohy (M10, Vercel Cron): `Authorization: Bearer ${CRON_SECRET}`. Vercel hodnotu posílá sám,
  // je-li proměnná nastavena v projektu. Bez ní všechny cesty `/api/cron/*` vrací 401.
  CRON_SECRET: secret.optional(),
  /** Jen automatické testy: `1` povolí parametr `now` (simulovaný čas) a `wedding_id`; v produkci odmítnuto. */
  CRON_TEST_CLOCK: z.enum(["1"]).optional(),

  // AWS SES. Bez těchto hodnot se e-maily jen vypíšou do konzole a neodesílají.
  AWS_REGION: z.string().min(1).optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),

  // Jen pro automatické testy (nikdy v produkci, viz src/lib/email/transport.ts)
  /** `outbox`: e-maily se zapisují jako soubory JSON do EMAIL_OUTBOX_DIR. */
  EMAIL_TRANSPORT: z.enum(["ses", "console", "outbox"]).optional(),
  EMAIL_OUTBOX_DIR: z.string().min(1).optional(),
});

// Prázdné řetězce (např. z .env) bereme jako nenastavené.
const raw = Object.fromEntries(
  Object.keys(schema.shape).map((key) => [key, process.env[key] || undefined]),
);

export const env = schema.parse(raw);

export type Env = typeof env;

/** Hodnota, bez které funkce nemůže běžet; chybějící hodnota je chyba nasazení, ne uživatele. */
export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Chybí proměnná prostředí ${String(key)}`);
  }
  return value as NonNullable<Env[K]>;
}
