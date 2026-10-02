import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/env";
import { mintTenantJwt, type MintTenantJwtInput } from "./jwt";

/**
 * Klient pro dotazy správce svatby: krátkodobé JWT (src/lib/db/jwt.ts) vydané serverem po ověření
 * vlastní relace. Politiky RLS z něj čtou `wedding_id` a `wedding_role`, takže dotaz nikdy nevidí
 * cizí svatbu (docs/adr/0001, docs/data-model.md kap. 5).
 *
 * Funkce před ověřením (`auth_*`, `rate_limit_hit`, `resolve_slug`) tímto klientem nevolejte:
 * jdou přes `src/lib/db/rpc.ts` s rolí service role.
 */

/** Nastavení supabase-js pro jeden požadavek: JWT v hlavičce, žádná relace ani obnovování. */
export function tenantClientOptions(jwt: string) {
  return {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  } as const;
}

/**
 * Klient s JWT jedné svatby. Argument `apikey` (klíč service role) jen projde bránou Supabase;
 * oprávnění určuje JWT v hlavičce `Authorization` (role `authenticated` + claimy svatby).
 * [OVĚŘIT] při zřízení projektu, že brána přijme tuto kombinaci (nové typy klíčů Supabase).
 * Platnost tokenu je minuty a klient se vytváří na jeden požadavek, nikdy se neukládá.
 */
export function createTenantClient(input: MintTenantJwtInput): SupabaseClient {
  const jwt = mintTenantJwt(input, { secret: requireEnv("SUPABASE_JWT_SECRET") });
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    tenantClientOptions(jwt),
  );
}
