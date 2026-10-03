import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { operator } from "@/config/operator";
import type { Locale } from "@/i18n/config";
import { localizedPath, localizedPaths, type PageRef } from "@/i18n/pathnames";
import { getTranslator } from "@/i18n/load";

export interface LandingFooterProps {
  locale: Locale;
  /** Stránka z tabulky cest, nebo adresy článku blogu v každém jazyce. */
  route: PageRef;
}

/** Patička: provozovatel a kontakt ze zástupné konfigurace, odkazy na sekce a právní stránky. */
export async function LandingFooter({ locale, route }: LandingFooterProps) {
  const t = await getTranslator(locale, ["common", "landing"]);
  const home = localizedPath("home", locale);
  const product = [
    { href: `${home}#how`, label: t("landing.nav.how") },
    { href: localizedPath("templates", locale), label: t("landing.nav.templates") },
    { href: localizedPath("pricing", locale), label: t("landing.nav.pricing") },
    { href: `${home}#faq`, label: t("landing.nav.faq") },
    { href: localizedPath("blog", locale), label: t("landing.nav.blog") },
  ];
  const legal = [
    { href: localizedPath("privacy", locale), label: t("landing.footer.privacy") },
    { href: localizedPath("terms", locale), label: t("landing.footer.terms") },
    { href: localizedPath("accessibility", locale), label: t("landing.footer.accessibility") },
  ];
  const linkClass =
    "min-h-target text-ink inline-flex items-center underline underline-offset-4 hover:bg-linen rounded-button px-2 -mx-2";

  return (
    <footer className="bg-parchment text-ink">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-8 md:grid-cols-[1.2fr_1fr_1fr_auto]">
        <div>
          <p className="font-sans text-xl font-extrabold tracking-tight">
            se-vezmou<span className="text-cinnamon-deep">.cz</span>
          </p>
          <p className="text-muted mt-3 max-w-xs">
            {t("landing.footer.about", { operator: operator.nameAndId, address: operator.address })}
          </p>
          <p className="text-muted mt-2 max-w-xs">
            {t("landing.footer.contact", { contact: operator.contact })}
          </p>
        </div>
        <nav aria-label={t("landing.footer.product")}>
          <ul className="flex flex-col">
            {product.map((link) => (
              <li key={link.href}>
                <a href={link.href} className={linkClass}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t("landing.footer.legal")}>
          <ul className="flex flex-col">
            {legal.map((link) => (
              <li key={link.href}>
                <a href={link.href} className={linkClass}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <LanguageSwitcher
          current={locale}
          hrefs={typeof route === "string" ? localizedPaths(route) : route}
          label={t("landing.footer.language")}
          short
          className="md:justify-self-end"
        />
      </div>
    </footer>
  );
}
