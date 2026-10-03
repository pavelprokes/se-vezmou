import { BedDouble, Clock, MapPin } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { Section, SectionHeading } from "./section";

/** Problém a řešení: tři otázky, které hosté kladou pořád dokola. */
export async function ProblemSection({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["landing"]);
  const cards = [
    {
      icon: MapPin,
      title: t("landing.problem.q1.title"),
      text: t("landing.problem.q1.text"),
    },
    {
      icon: Clock,
      title: t("landing.problem.q2.title"),
      text: t("landing.problem.q2.text"),
    },
    {
      icon: BedDouble,
      title: t("landing.problem.q3.title"),
      text: t("landing.problem.q3.text"),
    },
  ];

  return (
    <Section headingId="problem-title">
      <SectionHeading
        id="problem-title"
        title={t.rich("landing.problem.title", {
          b: (children) => <span className="heading-accent">{children}</span>,
        })}
        lead={t("landing.problem.lead")}
      />
      <ul className="mt-10 grid gap-5 md:grid-cols-3">
        {cards.map((card) => (
          <li key={card.title} className="border-hairline rounded-2xl border bg-white p-6">
            <Icon icon={card.icon} size={24} className="text-pine" />
            <h3 className="mt-4 font-sans text-lg font-bold">{card.title}</h3>
            <p className="text-muted mt-2">{card.text}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
