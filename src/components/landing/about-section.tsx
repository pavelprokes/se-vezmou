import { authorProjects, projectUrl } from "@/config/operator";
import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { Section, SectionHeading, itemTitleClass } from "./section";

/** O autorovi: svatební fotograf, ze kterého služba vzešla, a odkazy na jeho dva weby. */
export async function AboutSection({ locale, number }: { locale: Locale; number?: number }) {
  const t = await getTranslator(locale, ["landing"]);
  return (
    <Section id="about" headingId="about-title">
      <SectionHeading id="about-title" number={number} title={t("landing.about.title")} />
      <div className="mt-6 max-w-2xl space-y-4 text-lg text-pretty md:text-xl">
        <p>{t("landing.about.p1")}</p>
        <p>{t("landing.about.p2")}</p>
      </div>
      <ul aria-label={t("landing.about.projects")} className="mt-10 grid gap-10 md:grid-cols-2">
        {authorProjects.map(({ key, host }) => (
          <li key={key} className="border-ink border-t-2 pt-5">
            <h3 className={itemTitleClass}>
              <a
                href={projectUrl(host, "web", "o-autorovi")}
                className="min-h-target text-ink inline-flex items-center underline underline-offset-4"
              >
                {t(`landing.about.${key}.name`)}
              </a>
            </h3>
            <p className="text-muted mt-1 text-lg">{t(`landing.about.${key}.text`)}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
