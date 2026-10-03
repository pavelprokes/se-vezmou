import "server-only";
import { getUiLocale } from "@/auth/request";
import { getTranslator } from "@/i18n/load";
import type { Translator } from "@/i18n/translator";

/**
 * Překlady provozní administrace (`admin.se-vezmou.cz`) v jazyce požadavku: výchozí jazyk bez
 * předpony, ostatní pod `/<jazyk>` (stejné schéma jako `app.`, ADR 0013). Jen `common` a `ops`.
 */
export const OPS_NAMESPACES = ["common", "ops"] as const;

export type OpsT = Translator<(typeof OPS_NAMESPACES)[number]>;

export async function getOpsTranslator(): Promise<OpsT> {
  return getTranslator(await getUiLocale(), OPS_NAMESPACES);
}
