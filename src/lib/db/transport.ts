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
/** Zpětně kompatibilní název pro průvodce. */
export type RpcCaller = TenantIdentity;

export type RpcKind = "table" | "scalar";

/**
 * Volitelné vlastnosti volání. `readOnly`: funkce jen čte (v databázi `stable`). Transakce je pak `read only`
 * (zápis by selhal) a `commit` se neřadí před odpověď: výsledek se vrátí hned po dotazu, `commit` doběhne na
 * pozadí a spojení se vrátí do poolu až po něm. Role ani claimy se tím nemění.
 */
export type RpcOptions = { readOnly?: boolean };

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
    options?: RpcOptions,
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

/**
 * Textový literál pro příkaz s jednoduchým protokolem (stejně jako `escapeLiteral` v `pg`). Jde sem jen JSON
 * claimů sestavený z ověřených hodnot (UUID a pevné řetězce), takže zpětná lomítka a uvozovky jsou jen pojistka.
 */
export function escapeLiteral(value: string): string {
  let hasBackslash = false;
  let escaped = "'";
  for (const char of value) {
    if (char === "'") escaped += "''";
    else if (char === "\\") {
      escaped += "\\\\";
      hasBackslash = true;
    } else escaped += char;
  }
  escaped += "'";
  return hasBackslash ? ` E${escaped}` : escaped;
}

const pgTransport: RpcTransport = {
  async call(fn, args, kind, as, options) {
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

    const readOnly = options?.readOnly === true;
    const client = await (await getPool()).connect();
    let broken = false;
    let releaseLater = false;
    try {
      // Role i claimy jsou lokální pro transakci (`set local`, `set_config(..., true)`), takže přežijí jen do
      // commitu a spojení vrácené poolerem nemůže nést cizí totožnost. Začátek transakce, role a claimy jdou
      // jedním jednoduchým dotazem (jedna cesta sítí), teprve potom volání funkce s parametry.
      const setup = [
        `begin${readOnly ? " read only" : ""}`,
        `set local role ${as ? "authenticated" : "service_role"}`,
        ...(claims
          ? [`select set_config('request.jwt.claims', ${escapeLiteral(claims)}, true)`]
          : []),
      ].join("; ");
      await client.query(setup);
      const result = await client.query(
        sql,
        entries.map(([, value]) => value),
      );
      const value = kind === "table" ? result.rows : (result.rows[0]?.v ?? null);
      if (readOnly) {
        // Čtení nic nezapsalo: odpověď nečeká na commit, spojení se vrátí až po něm.
        releaseLater = true;
        void client
          .query("commit")
          .catch(() => {
            broken = true;
          })
          .finally(() => client.release(broken));
      } else {
        await client.query("commit");
      }
      return value;
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
      if (!releaseLater) client.release(broken);
    }
  },
};

/** Doprava databáze. Bez `DATABASE_URL` selže volání (ne sestavení) jasnou zprávou, viz pool.ts. */
export function getTransport(): RpcTransport {
  return pgTransport;
}
