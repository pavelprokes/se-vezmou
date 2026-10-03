import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/config";
import { localizedPath } from "@/i18n/pathnames";
import { getTranslator } from "@/i18n/load";
import { siteUrl } from "@/lib/site";
import { pageMetadata } from "@/seo/page-metadata";
import { LandingFooter } from "./landing-footer";
import { LandingHeader } from "./landing-header";
import { WaitlistConfirmForm } from "./waitlist-confirm-form";

const ROUTE = "waitlistConfirm";

/** Jazyk z adresy, pokud složka `segment` je jeho přeloženou cestou (cs `potvrzeni`, en `confirm`); jinak `null`. */
function confirmLocale(segment: string, localeParam: string): Locale | null {
  if (!isLocale(localeParam)) return null;
  return localizedPath(ROUTE, localeParam).split("/").pop() === segment ? localeParam : null;
}

export async function waitlistConfirmMetadata(
  segment: string,
  localeParam: string,
): Promise<Metadata> {
  const locale = confirmLocale(segment, localeParam);
  if (!locale) return {};
  const t = await getTranslator(locale, ["common", "landing", "marketing"]);
  return pageMetadata({
    route: ROUTE,
    locale,
    siteUrl,
    title: `${t("landing.waitlist.confirm.title")} | ${t("common.brand")}`,
    description: t("landing.waitlist.confirm.lead"),
    siteName: t("common.brand"),
    imageAlt: t("marketing.home.ogAlt"),
    noindex: true,
  });
}

/**
 * Stránka z odkazu v e-mailu čekací listiny: zápis se potvrdí až tlačítkem (skener pošty, který odkaz otevře,
 * nic nepotvrdí). Bez tokenu v adrese se ukáže jen vysvětlení. `noindex`, mimo mapu webu.
 */
export async function WaitlistConfirmPage({
  segment,
  localeParam,
  token,
}: {
  segment: string;
  localeParam: string;
  token: string | undefined;
}) {
  const locale = confirmLocale(segment, localeParam);
  if (!locale) notFound();
  const t = await getTranslator(locale, ["common", "landing", "marketing"]);
  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
  return (
    <>
      <LandingHeader locale={locale} route={ROUTE} />
      <main id="obsah" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-8">
        <h1 className="text-ink text-4xl font-medium md:text-5xl">
          {t("landing.waitlist.confirm.title")}
        </h1>
        <p className="text-muted mt-6 text-lg">
          {valid ? t("landing.waitlist.confirm.lead") : t("landing.waitlist.confirm.missing")}
        </p>
        {valid ? (
          <WaitlistConfirmForm
            token={token}
            labels={{
              submit: t("landing.waitlist.confirm.submit"),
              pending: t("landing.waitlist.pending"),
              confirmed: t("landing.waitlist.confirm.done"),
              invalid: t("landing.waitlist.confirm.invalid"),
              error: t("landing.waitlist.error.generic"),
            }}
          />
        ) : null}
      </main>
      <LandingFooter locale={locale} route={ROUTE} />
    </>
  );
}
