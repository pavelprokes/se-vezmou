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
  /** Výslovné povolení TLS bez ověření řetězu pro vzdálenou databázi bez DATABASE_CA_CERT (nedoporučeno). */
  DATABASE_TLS_INSECURE: z.string().min(1).optional(),

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
  /** Konfigurační sada SES (události doručení, vlastní potlačení); nepovinná. */
  SES_CONFIGURATION_SET: z.string().min(1).optional(),

  // Jen pro automatické testy (nikdy v produkci, viz src/lib/email/transport.ts)
  /** `outbox`: e-maily se zapisují jako soubory JSON do EMAIL_OUTBOX_DIR. */
  EMAIL_TRANSPORT: z.enum(["ses", "console", "outbox"]).optional(),
  EMAIL_OUTBOX_DIR: z.string().min(1).optional(),

  // Hostitelé a prostředí nasazení (dřív čteno přímo z process.env na více místech)
  /** Kořenová doména (`se-vezmou.cz`, lokálně `localhost`); src/host/resolve.ts. */
  ROOT_DOMAIN: z.string().min(1).optional(),
  /** Předvolba druhu hostitele pro náhledy mimo kořenovou doménu; pravidla v src/lib/test-hatches.ts. */
  HOST_PRESET: z.string().min(1).optional(),
  PREVIEW_TENANT_SLUG: z.string().min(1).optional(),
  NODE_ENV: z.string().min(1).optional(),
  /** Prostředí Vercelu (`production`, `preview`, `development`); nastavuje jen platforma. */
  VERCEL_ENV: z.string().min(1).optional(),
  /** Nastavuje jen platforma Vercel; podle ní se věří hlavičce `x-forwarded-for` (src/auth/request.ts). */
  VERCEL: z.string().min(1).optional(),
  /** Jen automatické testy: `1` povolí vrátka z src/lib/test-hatches.ts i v produkčním sestavení (e2e, CI). */
  ALLOW_TEST_HATCHES: z.string().min(1).optional(),
  ENABLE_UI_CATALOG: z.string().min(1).optional(),
  /**
   * Cloudflare Turnstile (ochrana formulářů průvodce a čekací listiny před roboty): tajný klíč pro ověření
   * tokenu na serveru. Veřejný klíč widgetu je NEXT_PUBLIC_TURNSTILE_SITE_KEY (vkládá se do sestavení).
   * Bez nich se ověření přeskočí (vývoj, testy); zůstávají limity požadavků a ověření e-mailem.
   */
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  /** Veřejný klíč widgetu Turnstile (do prohlížeče se vkládá při sestavení doslovným `process.env.…`). */
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  OG_FETCH_TEST_HOST: z.string().min(1).optional(),
  /** Jen automatické testy: `1` = mapa bez sítě (pevné souřadnice, šedé dlaždice), src/site/map/server.ts. */
  MAP_STUB: z.string().min(1).optional(),
  // SENTRY_ORG, SENTRY_PROJECT a SENTRY_AUTH_TOKEN čte jen next.config.ts při sestavení (před startem
  // aplikace), NEXT_PUBLIC_SENTRY_DSN se vkládá do sestavení doslovným `process.env.…` v sentry.*.config.ts
  // a instrumentation-client.ts. Proto nejsou tady.
});

type Parsed = z.output<typeof schema>;

/** Hodnoty, které selhaly při ověření: klíč -> důvod (bez hodnoty, ta může být tajná). */
const invalid = new Map<string, string>();
const cache = new Map<string, unknown>();

/** Veřejné adresy při chybné hodnotě spadnou na výchozí (kanonickou) adresu, ostatní klíče selžou při použití. */
const FALLBACK_ON_INVALID = new Set(["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_APP_URL"]);

function readKey(key: string): unknown {
  if (cache.has(key)) return cache.get(key);
  // Prázdné řetězce (např. z .env) bereme jako nenastavené.
  const rawValue = process.env[key] || undefined;
  const field = (schema.shape as Record<string, z.ZodType>)[key];
  const parsed = field.safeParse(rawValue);
  let value: unknown;
  if (parsed.success) {
    value = parsed.data;
  } else {
    const reason = parsed.error.issues[0]?.message ?? "neplatná hodnota";
    invalid.set(key, reason);
    console.error(`[env] Proměnná ${key} má neplatnou hodnotu (${reason}).`);
    if (FALLBACK_ON_INVALID.has(key)) {
      value = field.safeParse(undefined).data;
    } else {
      value = undefined;
    }
  }
  cache.set(key, value);
  return value;
}

/**
 * Ověřuje se líně po klíčích při prvním čtení, ne při importu: jedna špatná hodnota (kratší AUTH_SECRET,
 * chybná adresa) nesmí shodit všechny stránky včetně úvodní, jen funkci, která ji používá. Čtení
 * neplatného klíče bez náhradní hodnoty vyhodí srozumitelnou chybu (viz `requireEnv`).
 */
export const env = {} as Parsed;

for (const key of Object.keys(schema.shape)) {
  Object.defineProperty(env, key, {
    enumerable: true,
    get() {
      const value = readKey(key);
      if (invalid.has(key) && !FALLBACK_ON_INVALID.has(key)) {
        throw new Error(`Proměnná prostředí ${key} má neplatnou hodnotu: ${invalid.get(key)}.`);
      }
      return value;
    },
  });
}

export type Env = typeof env;

/** Hodnota, bez které funkce nemůže běžet; chybějící hodnota je chyba nasazení, ne uživatele. */
export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Chybí proměnná prostředí ${String(key)}`);
  }
  return value as NonNullable<Env[K]>;
}
