import "server-only";
import { ANONYMOUS_SUB, WEDDING_ROLES, type TenantClaims, type WeddingRole } from "./types";

// Claimy transakce pro roli `authenticated` (docs/adr/0011). Server je po ověření vlastní relace
// nastaví v transakci jako `request.jwt.claims`; pomocné funkce ve schématu se_vezmou je čtou
// (se_vezmou.jwt_claims()). Nejde o JWT: nic se nepodepisuje ani neposílá mimo server.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TenantIdentity = {
  weddingId: string;
  weddingRole: WeddingRole;
  /**
   * `wedding_admins.id` u `admin`, `sessions.id` u `guest_pin`. U `visitor` a `preview` se
   * ignoruje a použije se konstantní ANONYMOUS_SUB.
   */
  subject?: string;
};

/** Sestaví claimy a zkontroluje vstupy (chybný vstup se nikdy nedostane do databáze). */
export function buildTenantClaims(input: TenantIdentity): TenantClaims {
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
    sub = input.subject.toLowerCase();
  }

  return {
    sub,
    wedding_id: input.weddingId.toLowerCase(),
    wedding_role: input.weddingRole,
  };
}
