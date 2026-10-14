import { Check } from "lucide-react";
import { Fraunces } from "next/font/google";
import { BrandLogo } from "@/components/brand-logo";
import { Section, SectionHeading } from "@/components/landing/section";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { localizedPath } from "@/i18n/pathnames";
import { appUrl, siteUrl } from "@/lib/site";
import { buildWizardUrl } from "@/lib/wizard-link";
import { namesFromSlug } from "@/site/free-address";

// Písmo nadpisů úvodního webu (`font-display`), stejné jako na úvodní stránce. Bez přednačtení: web páru ho
// nepotřebuje, stáhne se jen s touto stránkou.
const fraunces = Fraunces({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-fraunces",
  display: "swap",
  preload: false,
});

/** Průměrná šířka znaku nadpisového písma v násobcích velikosti písma (naměřeno kolem 0,32, s rezervou pro širší znaky). */
const CHAR_WIDTH_EM = 0.4;
const ADDRESS_SIZE_MIN = "1.25rem";
const ADDRESS_SIZE_MAX = "4.5rem";

/**
 * Velikost písma adresy tak, aby se vešla na jeden řádek: `cqw` je setina šířky nadřazeného kontejneru
 * (`container-type: inline-size`). Velmi dlouhá adresa se zastaví na nejmenší velikosti a zalomí se až
 * u pomlčky (ne uprostřed slova); `overflow-wrap: anywhere` je jen nouze, aby nevznikl vodorovný posuv.
 */
function addressFontSize(length: number): string {
  const cqw = (100 / (length * CHAR_WIDTH_EM)).toFixed(2);
  return `clamp(${ADDRESS_SIZE_MIN}, ${cqw}cqw, ${ADDRESS_SIZE_MAX})`;
}

export interface FreeAddressProps {
  locale: Locale;
  /** Ověřený slug (jen `a-z0-9` a pomlčky, `isFreeAddressCandidate`). */
  slug: string;
  /** Adresa k zobrazení, `david-and-lil.se-vezmou.cz` (`addressHost`). */
  host: string;
}

/**
 * Stránka volné adresy (ADR 0015): `<slug>.se-vezmou.cz`, na které nikdo nemá web. Je to krátká vstupní stránka
 * k průvodci, ne šablona páru: komponenty a tokeny úvodní stránky, jedno hlavní tlačítko. Neukládá nic
 * a nezpracovává osobní údaje; slug se jen vypíše (React ho escapuje, navíc je ověřený regulárním výrazem).
 */
export async function FreeAddress({ locale, slug, host }: FreeAddressProps) {
  const t = await getTranslator(locale, ["common", "address"]);
  const domain = host.slice(slug.length);
  const names = namesFromSlug(slug, locale);
  const wizardUrl = buildWizardUrl({
    appUrl,
    locale,
    first: names?.first,
    second: names?.second,
    slug,
  });
  const home = `${siteUrl}${localizedPath("home", locale)}`;
  const steps = [
    { title: t("address.steps.1.title"), text: t("address.steps.1.text") },
    { title: t("address.steps.2.title"), text: t("address.steps.2.text") },
    { title: t("address.steps.3.title"), text: t("address.steps.3.text") },
  ];
  const linkClass =
    "min-h-target text-ink inline-flex items-center underline underline-offset-4 hover:bg-linen rounded-button px-2 -mx-2";

  return (
    <div className={`${fraunces.variable} flex flex-1 flex-col`}>
      <header className="bg-parchment text-ink">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-8">
          <a
            href={home}
            aria-label={t("common.brand")}
            className="min-h-target text-ink inline-flex items-center font-sans text-xl font-extrabold tracking-tight"
          >
            <BrandLogo />
          </a>
          <LanguageSwitcher
            current={locale}
            hrefs={{ cs: localizedPath("home", "cs"), en: localizedPath("home", "en") }}
            label={t("common.language.label")}
            short
          />
        </div>
      </header>

      <main id="obsah" tabIndex={-1} className="flex-1">
        <Section headingId="address-title" tone="parchment">
          <div className="max-w-4xl">
            <p className="bg-linen text-pine inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-base font-semibold">
              <Icon icon={Check} size={18} />
              <span>
                <span className="sr-only">{t("address.statusLabel")} </span>
                {t("address.status")}
              </span>
            </p>

            <div className="[container-type:inline-size] mt-6">
              <h1
                id="address-title"
                className="font-display leading-[1.1] font-normal tracking-tight [overflow-wrap:anywhere]"
                style={{ fontSize: addressFontSize(host.length) }}
              >
                <span>{slug}</span>
                <span className="whitespace-nowrap">{domain}</span>
              </h1>
            </div>

            <p className="font-display mt-8 text-2xl leading-tight text-balance md:text-4xl">
              {t("address.lead")}
            </p>
            <p className="text-muted mt-5 max-w-2xl text-lg text-pretty md:text-xl">
              {t("address.sub")}
            </p>

            <div className="mt-8 max-w-xl">
              <a
                href={wizardUrl}
                className={buttonVariants({ fullWidth: true, className: "sm:w-auto" })}
              >
                {t("address.cta")}
              </a>
              <p className="text-muted mt-4 text-base text-pretty">{t("address.note")}</p>
              <p className="mt-4">
                <a href={`${siteUrl}${localizedPath("templates", locale)}`} className={linkClass}>
                  {t("address.templates")}
                </a>
              </p>
            </div>
          </div>
        </Section>

        <Section headingId="address-steps-title" tone="warm">
          <SectionHeading id="address-steps-title" title={t("address.steps.title")} />
          <ol aria-label={t("address.steps.list")} className="mt-12 grid gap-10 md:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title} className="min-w-0">
                {/* Pořadí nese samotný číslovaný seznam; číslice je jen ozdoba. */}
                <span
                  aria-hidden="true"
                  className="font-display text-cinnamon-deep block text-7xl leading-none font-light"
                >
                  {index + 1}
                </span>
                <h3 className="mt-4 font-sans text-xl leading-snug font-semibold">{step.title}</h3>
                <p className="text-muted mt-2 text-lg">{step.text}</p>
              </li>
            ))}
          </ol>
        </Section>
      </main>

      <footer className="bg-parchment text-ink">
        <nav
          aria-label={t("address.footer.label")}
          className="mx-auto flex w-full max-w-6xl flex-wrap gap-x-6 gap-y-1 px-4 py-6 sm:px-8"
        >
          <a href={home} className={linkClass}>
            {t("address.footer.about")}
          </a>
          <a href={`${siteUrl}${localizedPath("privacy", locale)}`} className={linkClass}>
            {t("address.footer.privacy")}
          </a>
        </nav>
      </footer>
    </div>
  );
}
