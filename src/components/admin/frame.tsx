import type { ReactNode } from "react";
import { ADMIN_PATHS, appHref } from "@/admin/paths";
import { logoutAction } from "@/app/h/app/prihlaseni/actions";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { locales, type Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translator";
import { cn } from "@/lib/utils";
import { HelpBox, type HelpTopic } from "./help";

export type NavItem = "overview" | "site" | "history" | "help";

/**
 * Společný rámec obrazovek správy: hlavní nabídka, přepínač jazyka, odhlášení, nadpis a nápověda.
 * Nápověda je na každé obrazovce na stejném místě (WCAG 3.2.6): odkaz je v hlavní nabídce úplně
 * vpravo a stručná nápověda k obrazovce je hned pod nadpisem. Pořadí a poloha se mezi obrazovkami
 * nemění.
 */
export function AdminFrame({
  locale,
  path,
  active,
  title,
  intro,
  help,
  wide = false,
  children,
}: {
  locale: Locale;
  /** Cesta obrazovky bez předpony jazyka (přepínač jazyka vede na tutéž obrazovku). */
  path: string;
  active: NavItem;
  title: string;
  intro?: ReactNode;
  help: HelpTopic;
  wide?: boolean;
  children: ReactNode;
}) {
  const t = createTranslator(locale);
  const items: { key: NavItem; label: string; href: string }[] = [
    {
      key: "overview",
      label: t("admin.nav.overview"),
      href: appHref(ADMIN_PATHS.overview, locale),
    },
    { key: "site", label: t("admin.nav.site"), href: appHref(ADMIN_PATHS.site, locale) },
    { key: "history", label: t("admin.nav.history"), href: appHref(ADMIN_PATHS.history, locale) },
    { key: "help", label: t("admin.nav.help"), href: appHref(ADMIN_PATHS.help, locale) },
  ];
  const hrefs = Object.fromEntries(locales.map((l) => [l, appHref(path, l)])) as Record<
    Locale,
    string
  >;

  return (
    <>
      <header className="border-hairline border-b px-4 py-3 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <a
            href={appHref("/", locale)}
            className="min-h-target text-ink inline-flex items-center font-serif text-2xl font-medium"
          >
            {t("common.brand")}
          </a>
          <nav aria-label={t("admin.nav.label")}>
            <ul className="flex flex-wrap items-center gap-1">
              {items.map((item) => (
                <li key={item.key}>
                  <a
                    href={item.href}
                    aria-current={item.key === active ? "page" : undefined}
                    className={cn(
                      "min-h-target rounded-button inline-flex items-center px-3 text-base",
                      item.key === active
                        ? "bg-linen text-ink font-semibold underline underline-offset-4"
                        : "text-pine hover:bg-linen",
                    )}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex flex-wrap items-center gap-2">
            <LanguageSwitcher
              current={locale}
              hrefs={hrefs}
              label={t("admin.frame.language")}
              names={{ cs: t("common.language.cs"), en: t("common.language.en") }}
            />
            <form action={logoutAction}>
              <Button type="submit" variant="text">
                {t("admin.nav.logout")}
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main
        id="obsah"
        tabIndex={-1}
        className={cn("mx-auto w-full flex-1 px-4 py-8 sm:px-8", wide ? "max-w-7xl" : "max-w-3xl")}
      >
        <h1 className="text-ink text-3xl font-medium sm:text-4xl">{title}</h1>
        {intro ? <p className="text-muted mt-3 max-w-prose text-lg">{intro}</p> : null}
        <HelpBox locale={locale} topic={help} />
        <div className="mt-6">{children}</div>
      </main>
    </>
  );
}
