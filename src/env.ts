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

  // Provozní administrace (M9, docs/adr/0012)
  /** Klíč pro šifrování tajných klíčů TOTP operátorů v databázi a pro HMAC záložních kódů (min. 32 znaků). */
  OPERATOR_MFA_KEY: secret.optional(),
  // Plánované úlohy (M10, Vercel Cron): `Authorization: Bearer ${CRON_SECRET}`. Vercel hodnotu posílá sám,
  // je-li proměnná nastavena v projektu. Bez ní všechny cesty `/api/cron/*` vrací 401.
  // Záměrně bez minimální délky v schématu: špatná hodnota nesmí shodit start celé aplikace. Kratší než
  // 32 znaků cron odmítne (401 a chyba v logu), viz src/lib/cron/default.ts.
  CRON_SECRET: z.string().min(1).optional(),
  /** Jen automatické testy: `1` povolí parametr `now` (simulovaný čas) a `wedding_id`; v produkci odmítnuto. */
  CRON_TEST_CLOCK: z.string().min(1).optional(),

  // Fotografie páru (M7c, docs/adr/0006-photo-storage.md): Cloudflare R2, jen serverové proměnné. Bez nich se mimo
  // produkci používá úložiště v paměti; v produkci bez nich selže teprve použití fotografií (src/lib/storage).
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET: z.string().min(1).optional(),
  /** `https://<account-id>.eu.r2.cloudflarestorage.com`; bez zadání se odvodí z R2_ACCOUNT_ID. */
  R2_ENDPOINT: z.string().min(1).optional(),
  /** Oblast podpisu S3, u R2 vždy `auto`. */
  S3_REGION: z.string().min(1).optional(),
  /** Jen automatické testy (e2e proti produkčnímu sestavení): `memory` zapne úložiště v paměti. Nikdy v produkci. */
  STORAGE_DRIVER: z.string().min(1).optional(),

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
