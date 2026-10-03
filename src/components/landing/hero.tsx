import { ArrowRight, Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { appUrl } from "@/lib/site";
import { buildWizardUrl } from "@/lib/wizard-link";
import { HeroArt } from "./hero-art";

/** Hero: jediný `<h1>` stránky, hlavní výzva, odkaz na ukázku a ilustrace. */
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
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-8 pb-16 sm:px-8 md:grid-cols-[1.05fr_1fr] md:pt-16 md:pb-24">
        <div>
          <p className="text-cinnamon-deep text-sm font-bold tracking-widest uppercase">
            {t("landing.hero.eyebrow")}
          </p>
          <h1
            id="hero-title"
            className="mt-4 text-5xl leading-[1.05] font-medium tracking-tight text-balance md:text-6xl lg:text-7xl"
          >
            {t.rich("landing.hero.title", {
              b: (children) => <span className="heading-accent">{children}</span>,
            })}
          </h1>
          <p className="text-muted mt-6 max-w-md text-lg text-pretty">{t("landing.hero.lead")}</p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a href={buildWizardUrl({ appUrl, locale })} className={buttonVariants()}>
              {t("landing.hero.cta")}
              <Icon icon={ArrowRight} size={18} />
            </a>
            <a href="#templates" className={buttonVariants({ variant: "text" })}>
              {t("landing.hero.demo")}
            </a>
          </div>
          <ul aria-label={t("landing.hero.checks")} className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
            {checks.map((text) => (
              <li key={text} className="text-muted flex items-center gap-2 text-sm">
                <Icon icon={Check} size={16} className="text-pine" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <div className="mx-auto w-full max-w-xl">
          <HeroArt locale={locale} />
        </div>
      </div>
    </section>
  );
}
