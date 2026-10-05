import { testimonials as configured, type Testimonial } from "@/config/testimonials";
import { intlLocale, type Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { pick, resolvedLocale } from "@/site/i18n-text";
import { Section, SectionHeading } from "./section";

/**
 * Reference párů (`src/config/testimonials.ts`). Bez skutečných recenzí se nevykreslí vůbec.
 * Citát se ukáže v jazyce, ve kterém ho pár napsal, pokud chybí překlad (s atributem `lang`).
 */
export async function TestimonialsSection({
  locale,
  items = configured,
}: {
  locale: Locale;
  items?: readonly Testimonial[];
}) {
  if (items.length === 0) return null;
  const t = await getTranslator(locale, ["landing"]);
  const month = new Intl.DateTimeFormat(intlLocale[locale], { month: "long", year: "numeric" });

  return (
    <Section id="reference" headingId="testimonials-title">
      <SectionHeading id="testimonials-title" title={t("landing.testimonials.title")} />
      <ul className="mt-10 grid gap-6 md:grid-cols-2">
        {items.map((item) => {
          const quoteLocale = resolvedLocale(item.quote, locale);
          return (
            <li key={item.id} className="border-hairline rounded-2xl border bg-white p-6 md:p-8">
              <figure className="flex h-full flex-col gap-4">
                <blockquote
                  lang={quoteLocale !== locale ? (quoteLocale ?? undefined) : undefined}
                  className="font-display text-xl leading-snug"
                >
                  <p>{pick(item.quote, locale)}</p>
                </blockquote>
                <figcaption className="mt-auto flex items-center gap-3">
                  {item.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- malá statická fotka z public/
                    <img
                      src={item.photo}
                      alt=""
                      width={48}
                      height={48}
                      className="size-12 rounded-full object-cover"
                    />
                  ) : null}
                  <span>
                    <span className="block font-bold">{item.couple}</span>
                    <span className="text-muted block">
                      {t("landing.testimonials.wedding", {
                        date: month.format(new Date(`${item.weddingMonth}-01T12:00:00Z`)),
                      })}
                    </span>
                  </span>
                </figcaption>
              </figure>
            </li>
          );
        })}
      </ul>
      <p className="text-muted mt-6 max-w-prose">{t("landing.testimonials.verified")}</p>
    </Section>
  );
}
