/**
 * Náhled adresy `jmeno-a-jmeno.se-vezmou.cz` z jmen páru (jen ukázka na úvodní stránce;
 * skutečná adresa se vybírá a ověřuje v průvodci, modul slugů přijde v M3).
 */

function slugPart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `Klára`, `Matěj` -> `klara-a-matej`; bez obou jmen vrací `null`. */
export function previewSlug(first: string, second: string): string | null {
  const a = slugPart(first);
  const b = slugPart(second);
  if (!a && !b) return null;
  return [a, b].filter(Boolean).join("-a-");
}
