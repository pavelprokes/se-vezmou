import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { Section, SectionHeading } from "./section";
import { WaitlistForm } from "./waitlist-form";

/**
 * Oznámení o spuštění (čekací listina). Skutečné reference zatím nejsou, a proto tu nejsou ani zástupné
 * karty (žádné vymyšlené recenze, žádná strukturovaná data `Review`); sekce reference se přidá zpět,
 * až budou skutečné (docs/todo.md).
 */
export async function LaunchSection({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["landing"]);
  return (
    <Section id="launch" headingId="launch-title" tone="warm">
      <SectionHeading id="launch-title" title={t("landing.launch.title")} />
      <WaitlistForm locale={locale} />
    </Section>
  );
}
