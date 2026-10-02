/**
 * Rezervovaná slova, která nesmí být adresou webu páru (`<slug>.se-vezmou.cz`).
 * Seznam je na jednom místě; blokované výrazy a další rozšíření přijdou s modulem slugů (M3).
 */
export const RESERVED_SLUGS: readonly string[] = [
  "www",
  "app",
  "admin",
  "api",
  "mail",
  "podpora",
  "status",
  "static",
  "cdn",
];
