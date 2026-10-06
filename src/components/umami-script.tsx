import Script from "next/script";

/**
 * Umami (vlastní instance, bez cookies a osobních údajů, proto bez souhlasové lišty). Vykresluje se jen
 * v produkčním sestavení a jen když je nastaveno URL i ID webu. Navigace přes History API se měří sama.
 * `data-domains` je úvodní web a `app.` (adresy z `NEXT_PUBLIC_SITE_URL` a `NEXT_PUBLIC_APP_URL`).
 * Volá ho `Document` jen tam, kde je `measure` (ne na webech párů a `admin.`, ADR 0007).
 */
export function UmamiScript() {
  const url = process.env.NEXT_PUBLIC_UMAMI_URL?.replace(/\/+$/, "");
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  if (process.env.NODE_ENV !== "production" || !url || !websiteId) return null;
  const script = process.env.NEXT_PUBLIC_UMAMI_SCRIPT || "script.js";
  const domains = [
    process.env.NEXT_PUBLIC_SITE_URL || "https://se-vezmou.cz",
    process.env.NEXT_PUBLIC_APP_URL || "https://app.se-vezmou.cz",
  ].map((value) => new URL(value).hostname);
  return (
    <Script
      src={`${url}/${script}`}
      data-website-id={websiteId}
      data-domains={domains.join(",")}
      strategy="afterInteractive"
    />
  );
}
