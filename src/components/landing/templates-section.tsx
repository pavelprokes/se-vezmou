import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { Section, SectionHeading } from "./section";

/** Šablony: skutečné snímky úvodu webu pro ukázkový pár Klára a Matěj (`public/templates`, cs i en). */
const KEYS = ["editorial", "eucalyptus", "chateau", "modern"] as const;

export async function TemplatesSection({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["landing"]);
  const suffix = locale === "en" ? "-en" : "";

  return (
    <Section id="templates" headingId="templates-title">
      <SectionHeading
        id="templates-title"
        title={t("landing.templates.title")}
        lead={t("landing.templates.lead")}
      />
      <ul className="mt-10 grid gap-8 md:grid-cols-2">
        {KEYS.map((key) => {
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
                <figcaption className="mt-4">
                  <h3 className="font-sans text-lg font-bold">{name}</h3>
                  <p className="text-muted mt-1 text-sm">{t(`landing.templates.${key}.text`)}</p>
                </figcaption>
              </figure>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
