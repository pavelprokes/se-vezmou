import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { Section, sectionTitleClass } from "./section";

/** Co je služba: odpovědní blok (definice) vedle nadpisu. Jména páru se zadávají už v heru. */
export async function IntroSection({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["landing"]);
  return (
    <Section headingId="intro-title" tone="warm">
      <div className="grid gap-8 md:grid-cols-[1fr_1.4fr] md:gap-16">
        <h2 id="intro-title" className={sectionTitleClass}>
          {t("landing.intro.title")}
        </h2>
        <div className="border-ink border-t-2 pt-6">
          <p className="text-ink text-lg font-medium text-pretty md:text-xl">
            {t("landing.intro.lead")}
          </p>
          <p className="text-muted mt-4 text-lg text-pretty">{t("landing.intro.more")}</p>
        </div>
      </div>
    </Section>
  );
}
