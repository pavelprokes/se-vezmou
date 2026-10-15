/**
 * Roční počet svateb v ČR. Zdroj: Český statistický úřad, Pohyb obyvatelstva 2025
 * (42,5 tisíce sňatků). Aktualizuj, až ČSÚ zveřejní data za další rok.
 */
export const DEFAULT_YEARLY_WEDDINGS = 42_500;

/**
 * Kolik svateb proběhlo od 1. ledna roku, do kterého spadá `time` (ms od epochy),
 * při rovnoměrném rozložení `yearly` svateb přes celý rok.
 * Každý nový rok se počet sám vynuluje, protože se rok bere z `time`.
 * Přestupné roky jsou zohledněné (počítá se se skutečnou délkou roku v ms).
 */
export function weddingsSinceNewYear(time: number, yearly: number): number {
  const year = new Date(time).getFullYear();
  const yearStart = new Date(year, 0, 1).getTime();
  const yearEnd = new Date(year + 1, 0, 1).getTime();
  const perMs = yearly / (yearEnd - yearStart);
  return Math.floor((time - yearStart) * perMs);
}

/**
 * Čas, který běží `speed`-krát rychleji než skutečný, od okamžiku `startedAt`.
 * speed = 1 je reálný čas, speed = 60 znamená 1 sekunda = 1 minuta.
 */
export function acceleratedTime(startedAt: number, now: number, speed: number): number {
  return startedAt + (now - startedAt) * speed;
}
