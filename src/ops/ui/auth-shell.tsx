import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { localePath, locales, type Locale } from "@/i18n/config";
import { getOpsTranslator } from "../i18n";

/**
 * Rámec obrazovek přihlášení operátora: přepínač jazyka, hlavní oblast, nadpis a karta s obsahem.
 * Přepínač vede na tutéž obrazovku v jiném jazyce (`path` bez předpony jazyka).
 */
export async function OpsAuthShell({
  path,
  title,
  intro,
  children,
}: {
  path: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  const t = await getOpsTranslator();
  const hrefs = Object.fromEntries(locales.map((l) => [l, localePath(path, l)])) as Record<
    Locale,
    string
  >;
  return (
    <>
      <header className="flex justify-end px-4 pt-3 sm:px-8">
        <LanguageSwitcher current={t.locale} hrefs={hrefs} label={t("common.language.label")} />
      </header>
      <main id="obsah" tabIndex={-1} className="mx-auto w-full max-w-xl flex-1 px-4 py-12 sm:px-8">
        <h1 className="text-ink text-3xl font-medium sm:text-4xl">{title}</h1>
        {intro ? <p className="text-muted mt-4 max-w-prose text-lg">{intro}</p> : null}
        <Card className="mt-8">{children}</Card>
      </main>
    </>
  );
}
