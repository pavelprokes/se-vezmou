import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Autorizace plánovaných úloh: `Authorization: Bearer ${CRON_SECRET}`. Vercel Cron posílá hlavičku sám,
 * je-li CRON_SECRET nastaven v projektu. Čistý modul bez čtení prostředí (tajná hodnota je argument).
 *
 * Porovnání v konstantním čase: oba řetězce se nejdřív zahashují SHA-256, takže mají stejnou délku
 * a `timingSafeEqual` nevyzradí ani délku tajné hodnoty. Bez nastavené tajné hodnoty se nikdo
 * neautorizuje (nikdy „otevřeno, protože nic nenastaveno“).
 */

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

export function isAuthorizedCron(
  authorization: string | null | undefined,
  secret: string | undefined,
): boolean {
  // vždy proběhne stejné porovnání, ať je hlavička přítomná, nebo ne
  const presented = authorization ?? "";
  const expected = secret ? `Bearer ${secret}` : "";
  const equal = timingSafeEqual(digest(presented), digest(expected));
  return Boolean(secret) && equal;
}
