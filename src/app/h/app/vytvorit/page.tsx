import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentHostConfig } from "@/auth/app-origin";
import { getHost, getUiLocale } from "@/auth/request";
import { getSession } from "@/auth/session";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { WizardLoader } from "@/components/wizard/wizard-loader";
import { pickWizardMessages } from "@/components/wizard/messages";
import { isLocale, locales, type Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translator";
import { wizardLoad } from "@/lib/db/rpc-wizard";
import { NAME_MAX_LENGTH, WIZARD_PARAMS } from "@/lib/wizard-link";

/** Cesta průvodce v jazycích rozhraní (anglická varianta je pod `/en`, proxy ji přepíše sem). */
const PATHS: Record<Locale, string> = { cs: "/vytvorit", en: "/en/vytvorit" };

export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(await getUiLocale());
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

  // Odkaz z české úvodní stránky s `jazyk=en` patří na anglickou variantu průvodce.
  if (locale === "cs" && requested === "en") {
    const query = new URLSearchParams();
    for (const key of [WIZARD_PARAMS.first, WIZARD_PARAMS.second]) {
      const value = name(params[key]);
      if (value) query.set(key, value);
    }
    query.set(WIZARD_PARAMS.locale, "en");
    redirect(`${PATHS.en}?${query.toString()}`);
  }

  const session = await getSession();
  let server: { draft: unknown; previewEnabled: boolean } | null = null;
  if (session) {
    const state = await wizardLoad(session.weddingId);
    // Zveřejněný (nebo jinak uzavřený) web se v průvodci neupravuje.
    if (!state || state.status !== "draft") redirect("/");
    server = { draft: state.draft, previewEnabled: state.previewEnabled };
  }

  const host = (await getHost()) ?? "";
  const domain = /^app\./i.test(host)
    ? host.replace(/^app\./i, "").toLowerCase()
    : currentHostConfig().rootDomains[0];
  const siteLocale = isLocale(requested) ? requested : locale;

  const t = createTranslator(locale);
  const hrefs = Object.fromEntries(locales.map((l) => [l, PATHS[l]])) as Record<Locale, string>;

  return (
    <>
      <header className="border-hairline flex flex-wrap items-center justify-between gap-4 border-b px-4 py-3 sm:px-8">
        <a
          href="/"
          className="min-h-target text-ink inline-flex items-center font-serif text-2xl font-medium"
        >
          {t("common.brand")}
        </a>
        <LanguageSwitcher
          current={locale}
          hrefs={hrefs}
          label={t("common.language.label")}
          names={{ cs: t("common.language.cs"), en: t("common.language.en") }}
        />
      </header>
      <WizardLoader
        uiLocale={locale}
        messages={pickWizardMessages(locale)}
        domain={domain}
        prefill={{
          partnerA: name(params[WIZARD_PARAMS.first]),
          partnerB: name(params[WIZARD_PARAMS.second]),
          siteLocale,
        }}
        server={server}
      />
      <noscript>
        <p className="mx-auto max-w-3xl px-4 py-8">{t("wizard.noscript")}</p>
      </noscript>
    </>
  );
}
