import "server-only";
import { createHmac } from "node:crypto";
import {
  ANONYMOUS_SUB,
  TENANT_DB_ROLE,
  WEDDING_ROLES,
  type TenantClaims,
  type WeddingRole,
} from "./types";

// Tenký helper pro mintování krátkodobého JWT podle docs/adr/0001-database.md.
// JWT vzniká jen na serveru pro jeden požadavek, žije minuty a nikdy se neposílá prohlížeči
// ani neukládá do cookie. Databázové politiky z něj čtou `wedding_id` a `wedding_role`.
//
// Podpis: HS256 sdíleným tajemstvím projektu (JWT secret Supabase). Možnost podepisovat
// vlastním asymetrickým klíčem je v ADR 0001 označena [OVĚŘIT]; při změně se mění jen tento soubor.
//
// Soubor záměrně není nikam importován: napojení na přístupovou vrstvu je úkol dalších milníků.

/** Výchozí platnost tokenu v sekundách (návrh: pět minut). */
export const DEFAULT_TTL_SECONDS = 300;
/** Horní hranice platnosti: delší token by už nebyl "krátkodobý". */
export const MAX_TTL_SECONDS = 900;
const MIN_SECRET_LENGTH = 32;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MintTenantJwtInput = {
  weddingId: string;
  weddingRole: WeddingRole;
  /**
   * `wedding_admins.id` u `admin`, `sessions.id` u `guest_pin`. U `visitor` a `preview` se
   * ignoruje a použije se konstantní ANONYMOUS_SUB.
   */
  subject?: string;
};

export type MintTenantJwtOptions = {
  /** Podpisové tajemství (min. 32 znaků), čte ho volající z tajných proměnných. */
  secret: string;
  ttlSeconds?: number;
  /** Jen pro testy: aktuální čas. */
  now?: Date;
};

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Sestaví claimy tokenu a zkontroluje vstupy (chybný vstup nikdy nevydá token). */
export function buildTenantClaims(
  input: MintTenantJwtInput,
  options: Pick<MintTenantJwtOptions, "ttlSeconds" | "now"> = {},
): TenantClaims {
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_TTL_SECONDS) {
    throw new RangeError(`ttlSeconds musí být celé číslo 1 až ${MAX_TTL_SECONDS}`);
  }
  if (!WEDDING_ROLES.includes(input.weddingRole)) {
    throw new TypeError("Neznámá wedding_role");
  }
  if (!UUID_RE.test(input.weddingId)) {
    throw new TypeError("weddingId musí být UUID");
  }

  let sub: string;
  if (input.weddingRole === "visitor" || input.weddingRole === "preview") {
    sub = ANONYMOUS_SUB;
  } else {
    if (!input.subject || !UUID_RE.test(input.subject)) {
      throw new TypeError(`Role ${input.weddingRole} vyžaduje subject jako UUID`);
    }
    sub = input.subject;
  }

  const iat = Math.floor((options.now ?? new Date()).getTime() / 1000);
  return {
    sub,
    wedding_id: input.weddingId.toLowerCase(),
    role: TENANT_DB_ROLE,
    wedding_role: input.weddingRole,
    aud: "authenticated",
    iat,
    exp: iat + ttl,
  };
}

/** Vydá podepsaný JWT (HS256) s claimy sub, wedding_id, role = authenticated a wedding_role. */
export function mintTenantJwt(input: MintTenantJwtInput, options: MintTenantJwtOptions): string {
  if (options.secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`Podpisové tajemství musí mít aspoň ${MIN_SECRET_LENGTH} znaků`);
  }
  const claims = buildTenantClaims(input, options);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify(claims));
  const signature = createHmac("sha256", options.secret).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${base64url(signature)}`;
}
