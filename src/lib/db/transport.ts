import "server-only";
import { buildTenantClaims, type TenantIdentity } from "./claims";
import { getPool } from "./pool";

/**
 * Doprava volání funkcí databáze (RPC). Aplikace volá databázi jen ze serveru a jen přes funkce
 * `security definer` ve schématu `se_vezmou` (docs/adr/0011, docs/data-model.md kap. 5.5).
 *
 * Jediná cesta je přímé spojení `pg` (src/lib/db/pool.ts) jako aplikační role `se_vezmou_app`, která sama
 * nemá žádná práva. KAŽDÉ volání je jedna transakce:
 *  - před ověřením, cron a operátor: `set local role service_role`;
 *  - správce, host po PINu a návštěvník webu páru: `set local role authenticated` a claimy
 *    `set_config('request.jwt.claims', <json>, true)` (jen pro tuto transakci).
 * Zapomenuté `set role` skončí chybou oprávnění (role se_vezmou_app nemá k ničemu práva).
 */

export type { TenantIdentity };

export type RpcKind = "table" | "scalar";

/**
 * Totožnost volajícího pro funkce, které čtou claimy transakce (`se_vezmou.wedding_id()`, `se_vezmou.wedding_role()`):
 * návštěvník, host po PINu nebo správce jedné svatby. Bez ní se funkce volá jako service role.
 */

export interface RpcTransport {
  /**
   * `table`: pole řádků; `scalar`: jedna hodnota (nebo `null` u `void`). S `as` se funkce volá
   * s rolí `authenticated` a claimy té svatby.
   */
  call(
    fn: string,
    args: Record<string, unknown>,
    kind: RpcKind,
    as?: TenantIdentity,
  ): Promise<unknown>;
}

/** Hlášení, které je jen identifikátor (`rsvp_closed`): u takových zpráv nic osobního být nemůže. */
const REASON_PATTERN = /^[a-z][a-z_]{2,39}$/;

/**
 * Chyba databáze bez argumentů volání (mohou nést osobní údaje): jen funkce, kód a krátká zpráva.
 * `reason` je identifikátor chyby z naší funkce (`invalid_ticket`, `rsvp_closed`), když ho databáze
 * vrátila; jiné texty (typicky systémové hlášení o hodnotě, která chybu způsobila) se zahazují.
 */
export class DbError extends Error {
  readonly reason: string | undefined;

  constructor(
    readonly fn: string,
    readonly code: string | undefined,
    message: string,
  ) {
    super(`Databáze: ${fn} selhala (${code ?? "bez kódu"}): ${message}`);
    this.name = "DbError";
    this.reason = REASON_PATTERN.test(message) ? message : undefined;
  }
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

const pgTransport: RpcTransport = {
  async call(fn, args, kind, as) {
    if (!IDENTIFIER.test(fn)) throw new Error("Neplatný název funkce");
    const entries = Object.entries(args).filter(([, value]) => value !== undefined);
    for (const [key] of entries) {
      if (!IDENTIFIER.test(key)) throw new Error("Neplatný název argumentu");
    }
    const placeholders = entries.map(([key], index) => `${key} => $${index + 1}`).join(", ");
    const sql =
      kind === "table"
        ? `select * from se_vezmou.${fn}(${placeholders})`
        : `select se_vezmou.${fn}(${placeholders}) as v`;
    // Totožnost se ověří dřív, než se vezme spojení: chybný vstup se do databáze nedostane.
    const claims = as ? JSON.stringify(buildTenantClaims(as)) : undefined;

    const client = await (await getPool()).connect();
    let broken = false;
    try {
      // Role se mění uvnitř transakce (`set local`), takže přežije jen do commitu a spojení vrácené
      // poolerem nemůže nést cizí totožnost. Dva příkazy v jednom jednoduchém dotazu šetří cestu sítí.
      await client.query(`begin; set local role ${as ? "authenticated" : "service_role"}`);
      if (claims) {
        await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
      }
      const result = await client.query(
        sql,
        entries.map(([, value]) => value),
      );
      await client.query("commit");
      return kind === "table" ? result.rows : (result.rows[0]?.v ?? null);
    } catch (error) {
      await client.query("rollback").catch(() => {
        broken = true;
      });
      const code = (error as { code?: string }).code;
      const message = (error as { message?: string }).message ?? "";
      throw new DbError(
        fn,
        code,
        REASON_PATTERN.test(message) ? message : code ? "chyba SQL" : "chyba spojení",
      );
    } finally {
      // Spojení, na kterém selhal i rollback, se zahodí, ať se nevrátí do poolu v nejasném stavu.
      client.release(broken);
    }
  },
};

/** Doprava databáze. Bez `DATABASE_URL` selže volání (ne sestavení) jasnou zprávou, viz pool.ts. */
export function getTransport(): RpcTransport {
  return pgTransport;
}
