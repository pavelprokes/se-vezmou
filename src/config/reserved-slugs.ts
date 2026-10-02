/**
 * Rezervovaná slova, která nesmí být adresou webu páru (`<slug>.se-vezmou.cz`) a která
 * směrování podle hostitele nikdy nepovažuje za web páru.
 * Úplný seznam rezervovaných slov a blokovaných výrazů drží databáze (`slug_registry`, migrace
 * `seed` a `wizard`); tento seznam je jeho podmnožina pro rychlou kontrolu bez databáze.
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

/**
 * Blokované výrazy (vulgarismy, urážky, podobnost s cizími značkami a bankami; OQ-37): adresa je
 * nedostupná, pokud některý její díl mezi pomlčkami (alespoň čtyři znaky) je v seznamu.
 * Autoritativní je databáze (`app.slug_has_reserved_token`); tento seznam slouží jen k okamžité
 * nápovědě v průvodci a test hlídá, že je shodný s migrací `20261002150000_wizard.sql`.
 */
// prettier-ignore
export const BLOCKED_SLUG_WORDS: readonly string[] = [
  "kurva", "kurvy", "kurevnik", "pica", "picus", "pico", "curak", "kokot", "kokoti", "debil",
  "idiot", "hovno", "hovna", "sracka", "zmrd", "jebat", "jebnuty", "pizda", "hajzl", "buzna",
  "buzerant", "mrdat", "mrdka", "couma", "kunda", "prdel", "negr", "zidak", "cikan", "nacista",
  "nacismus", "hitler", "nazi", "paypal", "google", "facebook", "instagram", "seznam", "csob",
  "moneta", "airbank", "raiffeisen", "komercni", "sporitelna", "policie", "banka", "platba",
  "platby", "payment", "secure", "verify", "security", "account", "ucet", "heslo", "password",
  "prihlaseni", "overeni", "ceskaposta", "financnisprava",
];

/** Rezervovaná slova z migrace `seed` (kromě těch, které už jsou v `RESERVED_SLUGS`). */
// prettier-ignore
export const EXTRA_RESERVED_SLUGS: readonly string[] = [
  "ns1", "ns2", "smtp", "bounce", "imap", "pop", "mx", "webmail", "autodiscover", "autoconfig",
  "ftp", "staging", "pre-prod", "preview", "dev", "test", "se-vezmou", "sevezmou", "vezmou",
  "login", "support", "help", "docs", "blog", "en", "cs",
];
