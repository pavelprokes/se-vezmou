/**
 * Smazaná fotografie zmizí z webu hned, i když zveřejněný snímek na ni ještě odkazuje (nová verze se nemusela
 * zveřejnit): web ze snímku vyřadí média, která už v databázi nejsou hotová. Média bez variant (starší snímky a
 * vývojové fixtury se souborem ve `public/`) se nikdy nevyřazují, nejsou v úložišti. Čistá funkce.
 */
export function liveMedia<T extends { id: string; widths: readonly number[] }>(
  media: readonly T[],
  alive: ReadonlySet<string>,
): T[] {
  return media.filter((item) => item.widths.length === 0 || alive.has(item.id.toLowerCase()));
}
