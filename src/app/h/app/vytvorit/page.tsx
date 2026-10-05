import { BrandLogo } from "@/components/brand-logo";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GUIDE_PATH, appHref } from "@/admin/paths";
import { currentHostConfig } from "@/auth/app-origin";
import { getHost, getUiLocale } from "@/auth/request";
import { localHref } from "@/auth/local-href";
import { getSession } from "@/auth/session";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { WizardLoader } from "@/components/wizard/wizard-loader";
import { pickWizardMessages } from "@/components/wizard/messages";
import { defaultLocale, isLocale, locales, type Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { wizardLoad } from "@/lib/db/rpc-wizard";
import { NAME_MAX_LENGTH, WIZARD_PARAMS, wizardPath } from "@/lib/wizard-link";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator(await getUiLocale(), ["common", "wizard"]);
  return { title: t("wizard.meta.title") };
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function name(value: string | string[] | undefined): string {
  return first(value).replace(/\s+/g, " ").trim().slice(0, NAME_MAX_LENGTH);
}

/**
 * Průvodce vytvořením webu (FR-WZ-1): 9 kroků, česky na `/vytvorit`, anglicky na `/en/vytvorit`.
 * Úvodní stránka sem posílá jména a jazyk v adrese (FR-LP-5, `jmeno1`, `jmeno2`, `jazyk`).
 * Kroky 1 až 3 fungují bez účtu (koncept je v prohlížeči); s relací se načte koncept ze serveru.
 */
export default async function WizardPage({ searchParams }: PageProps<"/h/app/vytvorit">) {
  const locale = await getUiLocale();
  const params = await searchParams;
  const requested = first(params[WIZARD_PARAMS.locale]);

  // Starší odkaz bez předpony s `jazyk=en` (jiný než výchozí jazyk) patří na průvodce v tom jazyce.
  if (locale === defaultLocale && isLocale(requested) && requested !== defaultLocale) {
    const query = new URLSearchParams();
    for (const key of [WIZARD_PARAMS.first, WIZARD_PARAMS.second]) {
      const value = name(params[key]);
      if (value) query.set(key, value);
    }
    query.set(WIZARD_PARAMS.locale, requested);
    redirect(`${wizardPath(requested)}?${query.toString()}`);
  }

  const session = await getSession();
  let server: { draft: unknown; previewEnabled: boolean } | null = null;
  if (session) {
    const state = await wizardLoad(session.weddingId);
    // Zveřejněný (nebo jinak uzavřený) web se v průvodci neupravuje.
    if (!state || state.status !== "draft") redirect(await localHref("/"));
    server = { draft: state.draft, previewEnabled: state.previewEnabled };
  }

  const host = (await getHost()) ?? "";
  const domain = /^app\./i.test(host)
    ? host.replace(/^app\./i, "").toLowerCase()
    : currentHostConfig().rootDomains[0];
  const siteLocale = isLocale(requested) ? requested : locale;

  const t = await getTranslator(locale, ["common", "wizard"]);
  const hrefs = Object.fromEntries(locales.map((l) => [l, wizardPath(l)])) as Record<
    Locale,
    string
  >;

  return (
    <>
      <header className="border-hairline flex flex-wrap items-center justify-between gap-4 border-b px-4 py-3 sm:px-8">
        <a
          href={appHref("/", locale)}
          className="min-h-target text-ink inline-flex items-center text-xl"
        >
          <BrandLogo />
        </a>
        <div className="flex flex-wrap items-center gap-4">
          <a
            href={GUIDE_PATH}
            target="_blank"
            rel="noopener"
            className="min-h-target text-pine inline-flex items-center underline underline-offset-4"
          >
            {t("wizard.guide.link")}
            <span className="sr-only"> {t("wizard.guide.newWindow")}</span>
          </a>
          <LanguageSwitcher current={locale} hrefs={hrefs} label={t("common.language.label")} />
        </div>
      </header>
      <WizardLoader
        uiLocale={locale}
        messages={await pickWizardMessages(locale)}
        domain={domain}
        prefill={{
          partnerA: name(params[WIZARD_PARAMS.first]),
          partnerB: name(params[WIZARD_PARAMS.second]),
          siteLocale,
        }}
        server={server}
        noscript={t("wizard.noscript")}
      />
    </>
  );
}
