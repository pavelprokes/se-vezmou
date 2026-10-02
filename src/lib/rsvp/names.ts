/**
 * Normalizace jmen pro porovnání hostů (docs/data-model.md kap. 3.4). TypeScriptová dvojice
 * SQL funkcí `app.normalize_name` a `app.name_key`; slouží náhledu a deduplikaci (například při
 * importu seznamu hostů). Rozhodnutí o shodě při RSVP dělá vždy databáze (`rsvp_match`).
 *
 * Obě implementace ověřují společné zlaté vektory `supabase/tests/golden/name-vectors.tsv`
 * (Vitest `names.test.ts` a SQL test `90_lifecycle`), takže se nemohou rozejít.
 *
 * Čistý modul bez závislostí, použitelný na serveru i v prohlížeči.
 */

/**
 * Unicode NFKD, odstranění kombinujících znamének (diakritiky), malá písmena, odstraněné
 * apostrofy, interpunkce a mezery převedené na jednu mezeru.
 *
 * SQL: `[[:punct:][:space:]]+` -> mezera. Tady `[^\p{L}\p{N}\p{M}]+`, tedy vše kromě písmen, číslic
 * a (nesvlečených) značek; pro běžná jména jsou obě definice shodné a hlídají to zlaté vektory.
 */
export function normalizeName(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’´`]/g, "")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
}

const encoder = new TextEncoder();

/** Řazení podle bajtů UTF-8, jako `collate "C"` v databázi (nezávislé na jazyce a prohlížeči). */
function compareBytes(a: string, b: string): number {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

/** Normalizovaný tvar se slovy seřazenými abecedně ("Novák Matěj" = "Matěj Novák"). */
export function nameKey(input: string): string {
  return normalizeName(input)
    .split(" ")
    .filter((token) => token !== "")
    .sort(compareBytes)
    .join(" ");
}
