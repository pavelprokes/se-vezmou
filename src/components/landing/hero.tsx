import { Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { appUrl, siteUrl } from "@/lib/site";
import { HeroStudio } from "./hero-studio";
import { HERO_TEMPLATE_KEYS } from "./templates-section";

/** Doména pro náhled adresy páru: kořenová doména z `NEXT_PUBLIC_SITE_URL`. */
const domain = new URL(siteUrl).hostname;

/** Hero: jediný `<h1>` stránky, jména páru s živým náhledem webu a odkaz na šablony. */
export async function Hero({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["landing"]);
  const checks = [
    t("landing.hero.check1"),
    t("landing.hero.check2"),
    t("landing.hero.check3"),
    t("landing.hero.check4"),
  ];

  return (
    <section aria-labelledby="hero-title" className="bg-parchment text-ink">
      <div className="mx-auto w-full max-w-6xl px-4 pt-8 pb-16 sm:px-8 md:pt-16 md:pb-24">
        <HeroStudio
          appUrl={appUrl}
          locale={locale}
          domain={domain}
          formLabels={{
            first: t("landing.form.first"),
            second: t("landing.form.second"),
            firstPlaceholder: t("landing.form.firstPlaceholder"),
            secondPlaceholder: t("landing.form.secondPlaceholder"),
            submit: t("landing.hero.cta"),
            form: t("landing.hero.formLabel"),
          }}
          addressLabel={t("landing.form.address")}
          templatesLabel={t("landing.hero.templatesLabel")}
          templates={HERO_TEMPLATE_KEYS.map((key) => ({
            key,
            name: t(`landing.templates.${key}.name`),
          }))}
          dateplace={t("landing.sample.dateplace")}
          rsvp={t("landing.sample.rsvp")}
          intro={
            <div>
              <p className="text-cinnamon-deep text-sm font-bold tracking-widest uppercase">
                {t("landing.hero.eyebrow")}
              </p>
              <h1
                id="hero-title"
                className="font-display mt-4 text-5xl leading-[0.98] font-normal tracking-tight text-balance md:text-6xl lg:text-[5.5rem]"
              >
                {t.rich("landing.hero.title", {
                  b: (children) => <span className="heading-accent">{children}</span>,
                })}
              </h1>
              <p className="text-muted mt-6 max-w-md text-lg text-pretty md:text-xl">
                {t("landing.hero.lead")}
              </p>
            </div>
          }
          outro={
            <div className="flex flex-col items-start gap-5">
              <a
                href="#templates"
                className={buttonVariants({ variant: "text", className: "px-0" })}
              >
                {t("landing.hero.demo")}
              </a>
              <ul aria-label={t("landing.hero.checks")} className="flex flex-wrap gap-x-6 gap-y-2">
                {checks.map((text) => (
                  <li key={text} className="text-muted flex items-center gap-2 text-base">
                    <Icon icon={Check} size={16} className="text-pine" />
                    {text}
                  </li>
                ))}
              </ul>
            </div>
          }
        />
      </div>
    </section>
  );
}
