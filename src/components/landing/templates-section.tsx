import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { templates } from "@/site/themes/palettes";
import { Section, SectionHeading, itemTitleClass } from "./section";

/** Šablony: skutečné snímky úvodu webu pro ukázkový pár Klára a Matěj (`public/templates`, cs i en). */
export const TEMPLATE_KEYS = [
  "editorial",
  "eucalyptus",
  "chateau",
  "modern",
  "statek",
  "vinice",
  "louka",
  "deco",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Šablony v živém náhledu úvodu (zjednodušené makety v `hero-studio.tsx`). */
export const HERO_TEMPLATE_KEYS = ["editorial", "eucalyptus", "chateau", "modern"] as const;
export type HeroTemplateKey = (typeof HERO_TEMPLATE_KEYS)[number];

/** Klíč šablony v textech úvodního webu → klíč v definici šablon (palety). */
const THEME_KEY = {
  editorial: "editorial",
  eucalyptus: "eukalyptus",
  chateau: "chateau",
  modern: "modern",
  statek: "statek",
  vinice: "vinice",
  louka: "louka",
  deco: "deco",
} as const satisfies Record<TemplateKey, keyof typeof templates>;

/** `detailed`: stránka šablon (popis a názvy palet z jejich definice); úvodní stránka má jen krátký podtitul. */
export async function TemplatesSection({
  locale,
  number,
  detailed = false,
}: {
  locale: Locale;
  number?: number;
  detailed?: boolean;
}) {
  const t = await getTranslator(locale, ["landing", "marketing"]);
  const suffix = locale === "en" ? "-en" : "";

  return (
    <Section id="templates" headingId="templates-title">
      <SectionHeading
        id="templates-title"
        number={number}
        title={t("landing.templates.title")}
        lead={t("landing.templates.lead")}
      />
      <ul className="mt-12 grid gap-x-8 gap-y-12 md:grid-cols-2">
        {TEMPLATE_KEYS.map((key) => {
          const name = t(`landing.templates.${key}.name`);
          return (
            <li key={key}>
              <figure>
                {/* Hotový WebP: `next/image` by ho jen znovu překódoval. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/templates/${key}${suffix}.webp`}
                  alt={t("landing.templates.preview", { name })}
                  width={960}
                  height={600}
                  loading="lazy"
                  decoding="async"
                  className="border-hairline w-full rounded-2xl border"
                />
                <figcaption className="mt-5">
                  <h3 className={itemTitleClass}>{name}</h3>
                  <p className="text-muted mt-1 text-lg">{t(`landing.templates.${key}.text`)}</p>
                  {detailed ? (
                    <>
                      <p className="mt-3 text-lg">{t(`marketing.templates.details.${key}`)}</p>
                      <p className="text-muted mt-2">
                        {t("marketing.templates.palettes", {
                          names: templates[THEME_KEY[key]].palettes
                            .map((palette) => palette.name[locale])
                            .join(", "),
                        })}
                      </p>
                    </>
                  ) : null}
                </figcaption>
              </figure>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
