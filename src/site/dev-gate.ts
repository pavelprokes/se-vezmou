/**
 * Vývojářské stránky (náhled šablon) mimo produkci: nikdy s `VERCEL_ENV=production`, jinde jen ve
 * vývojovém režimu nebo s `ENABLE_UI_CATALOG=1` (stejné pravidlo jako katalog UI z M1).
 * Čte prostředí při každém volání; volající stránka musí být vykreslená za běhu (`connection()`).
 */
export function devPagesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.VERCEL_ENV !== "production" &&
    (env.NODE_ENV !== "production" || env.ENABLE_UI_CATALOG === "1")
  );
}
