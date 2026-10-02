/**
 * Přechod na jinou stránku správy po uložení: plné načtení stránky, aby seznamy ukázaly čerstvá data
 * ze serveru a stav ukládání se vynuloval. Cesta je vždy vlastní (stejný původ).
 */
export function go(href: string): void {
  window.location.assign(new URL(href, window.location.origin).toString());
}
