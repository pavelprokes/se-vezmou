import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { cn } from "@/lib/utils";
import { Section, SectionHeading } from "./section";

function Mock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("mt-4", className)}>
      {children}
    </div>
  );
}

interface Feature {
  key: string;
  title: string;
  text: string;
  className?: string;
  mock?: ReactNode;
}

/** Co web umí: sedm funkcí a pruh toho, čím se lišíme. Náhledy jsou dekorace, text nese význam. */
export async function FeaturesSection({ locale, number }: { locale: Locale; number?: number }) {
  const t = await getTranslator(locale, ["landing"]);
  const programRows = [
    [t("landing.features.program.time1"), t("landing.features.program.what1")],
    [t("landing.features.program.time2"), t("landing.features.program.what2")],
    [t("landing.features.program.time3"), t("landing.features.program.what3")],
  ];

  const features: Feature[] = [
    {
      key: "rsvp",
      title: t("landing.features.rsvp.title"),
      text: t("landing.features.rsvp.text"),
      className: "lg:col-span-2",
      mock: (
        <Mock className="max-w-xs rounded-xl bg-white p-3">
          <p className="text-ink text-xs font-bold">{t("landing.features.rsvp.question")}</p>
          <div className="mt-2 flex gap-2 text-xs font-medium">
            <span className="border-pine bg-pine text-parchment flex-1 rounded-full border-2 px-3 py-1 text-center">
              {t("landing.features.rsvp.yes")}
            </span>
            <span className="border-pine text-pine flex-1 rounded-full border-2 px-3 py-1 text-center">
              {t("landing.features.rsvp.no")}
            </span>
          </div>
          <span className="bg-linen mt-3 block h-1.5 rounded-full" />
        </Mock>
      ),
    },
    {
      key: "program",
      title: t("landing.features.program.title"),
      text: t("landing.features.program.text"),
      mock: (
        <Mock className="rounded-xl bg-white p-3 text-xs">
          {programRows.map(([time, what]) => (
            <div key={time} className="flex gap-3 py-0.5">
              <span className="text-pine w-14 shrink-0 font-semibold tabular-nums">{time}</span>
              <span className="text-ink">{what}</span>
            </div>
          ))}
        </Mock>
      ),
    },
    {
      key: "stay",
      title: t("landing.features.stay.title"),
      text: t("landing.features.stay.text"),
    },
    {
      key: "faq",
      title: t("landing.features.faq.title"),
      text: t("landing.features.faq.text"),
    },
    {
      key: "gifts",
      title: t("landing.features.gifts.title"),
      text: t("landing.features.gifts.text"),
      mock: (
        <Mock className="flex gap-2">
          {[0, 1, 2, 3].map((n) => (
            <span
              key={n}
              className={cn(
                "flex size-9 items-center justify-center rounded-md border-2 bg-white text-lg leading-none",
                n === 3 ? "border-pine" : "border-field-border",
              )}
            >
              {n < 3 ? "•" : ""}
            </span>
          ))}
        </Mock>
      ),
    },
    {
      key: "languages",
      title: t("landing.features.languages.title"),
      text: t("landing.features.languages.text"),
      mock: (
        <Mock className="inline-flex rounded-full bg-white p-1 text-xs font-bold">
          <span className="bg-ink text-parchment rounded-full px-3 py-1">
            {t("landing.features.languages.cs")}
          </span>
          <span className="text-ink rounded-full px-3 py-1">
            {t("landing.features.languages.en")}
          </span>
        </Mock>
      ),
    },
    {
      key: "edit",
      title: t("landing.features.edit.title"),
      text: t("landing.features.edit.text"),
    },
  ];

  return (
    <Section id="features" headingId="features-title" tone="warm">
      <SectionHeading
        id="features-title"
        number={number}
        title={t("landing.features.title")}
        lead={t("landing.features.lead")}
      />
      <ul className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((feature) => (
          <li
            key={feature.key}
            className={cn("border-ink min-w-0 border-t-2 pt-5", feature.className)}
          >
            <h3 className="font-display text-2xl leading-snug font-medium">{feature.title}</h3>
            <p className="text-muted mt-2 text-base">{feature.text}</p>
            {feature.mock}
          </li>
        ))}
        <li className="border-ink border-t-2 pt-5 sm:col-span-2 lg:col-span-4">
          <h3 className="font-display text-2xl leading-snug font-medium">
            {t("landing.features.extra.title")}
          </h3>
          <ul className="mt-4 grid gap-x-6 gap-y-2 text-base sm:grid-cols-2 lg:grid-cols-4">
            {([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const).map((n) => (
              <li key={n} className="flex items-start gap-2">
                <Icon icon={Check} size={16} className="text-pine mt-1 shrink-0" />
                {t(`landing.features.extra.${n}`)}
              </li>
            ))}
          </ul>
        </li>
      </ul>
    </Section>
  );
}
