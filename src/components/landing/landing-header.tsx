import { buttonVariants } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import type { Locale } from "@/i18n/config";
import { localizedPath, localizedPaths, type PageRef } from "@/i18n/pathnames";
import { getTranslator } from "@/i18n/load";
import { appUrl } from "@/lib/site";
import { buildWizardUrl } from "@/lib/wizard-link";
import { HeaderMenu } from "./header-menu";

export interface LandingHeaderProps {
  locale: Locale;
  /** Stránka, na které hlavička stojí; přepínač odkazuje na její druhou jazykovou verzi. */
  route: PageRef;
}

/** Hlavička úvodní stránky a právních podstránek: značka, kotvy sekcí, přepínač jazyka a výzva. */
export async function LandingHeader({ locale, route }: LandingHeaderProps) {
  const t = await getTranslator(locale, ["common", "landing"]);
  const home = localizedPath("home", locale);
  const links = [
    { href: `${home}#how`, label: t("landing.nav.how") },
    { href: localizedPath("templates", locale), label: t("landing.nav.templates") },
    { href: localizedPath("pricing", locale), label: t("landing.nav.pricing") },
    { href: `${home}#faq`, label: t("landing.nav.faq") },
    { href: localizedPath("blog", locale), label: t("landing.nav.blog") },
  ];

  return (
    <header className="bg-parchment text-ink">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-8">
        <a
          href={home}
          aria-label={t("landing.nav.home")}
          className="min-h-target text-ink inline-flex items-center font-sans text-xl font-extrabold tracking-tight"
        >
          se-vezmou<span className="text-cinnamon-deep">.cz</span>
        </a>
        <HeaderMenu buttonLabel={t("landing.nav.menu")}>
          <nav aria-label={t("landing.nav.label")} className="md:ml-auto">
            <ul className="flex flex-col gap-1 md:flex-row md:items-center md:gap-2">
              {links.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="min-h-target hover:bg-linen rounded-button text-ink inline-flex items-center px-3 text-base"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <LanguageSwitcher
            current={locale}
            hrefs={typeof route === "string" ? localizedPaths(route) : route}
            label={t("common.language.label")}
            short
          />
          <a
            href={buildWizardUrl({ appUrl, locale })}
            className={buttonVariants({ className: "self-start md:self-auto" })}
          >
            {t("landing.nav.cta")}
          </a>
        </HeaderMenu>
      </div>
    </header>
  );
}
