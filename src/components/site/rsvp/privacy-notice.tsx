import type { Locale } from "@/i18n/config";
import { localizedPath } from "@/i18n/pathnames";
import type { Translator } from "@/i18n/translator";
import { siteUrl } from "@/lib/site";

/**
 * Krátká informace o zpracování údajů při potvrzení účasti (docs/security-privacy.md kap. 5.5):
 * správcem údajů hostů je pár, provozovatel je zpracovatel, odkaz vede na zásady zpracování.
 *
 * Zásady (`/soukromi`, `/en/privacy`) se obsluhují jen na hostiteli úvodní stránky, na webu páru
 * tato adresa neexistuje, proto odkaz míří na absolutní adresu `NEXT_PUBLIC_SITE_URL`. Otevírá se
 * v nové záložce, aby host nepřišel o rozepsanou odpověď.
 *
 * Znění je právní text a `[OTÁZKA]` pro právníka (docs/security-privacy.md kap. 11, bod 9).
 */
export function RsvpPrivacyNotice({
  t,
  locale,
  partners,
}: {
  t: Translator<"rsvp" | "site" | "common">;
  locale: Locale;
  partners: { a: string; b: string };
}) {
  const href = `${siteUrl}${localizedPath("privacy", locale)}`;
  return (
    <p className="site-muted site-hint" data-testid="rsvp-privacy-notice">
      {t.rich(
        "rsvp.privacy.notice",
        {
          a: (children) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="site-link">
              {children}
            </a>
          ),
        },
        { first: partners.a, second: partners.b },
      )}
    </p>
  );
}
