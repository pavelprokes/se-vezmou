import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { Section, SectionHeading } from "./section";
import {
  ChateauPreview,
  EditorialPreview,
  EucalyptusPreview,
  ModernPreview,
} from "./template-previews";

/** Šablony: čtyři živé ukázky s ukázkovými jmény Klára a Matěj. */
export async function TemplatesSection({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["landing"]);
  const templates = [
    {
      name: t("landing.templates.editorial.name"),
      text: t("landing.templates.editorial.text"),
      preview: <EditorialPreview t={t} />,
    },
    {
      name: t("landing.templates.eucalyptus.name"),
      text: t("landing.templates.eucalyptus.text"),
      preview: <EucalyptusPreview t={t} />,
    },
    {
      name: t("landing.templates.chateau.name"),
      text: t("landing.templates.chateau.text"),
      preview: <ChateauPreview t={t} />,
    },
    {
      name: t("landing.templates.modern.name"),
      text: t("landing.templates.modern.text"),
      preview: <ModernPreview t={t} />,
    },
  ];

  return (
    <Section id="templates" headingId="templates-title">
      <SectionHeading
        id="templates-title"
        title={t("landing.templates.title")}
        lead={t("landing.templates.lead")}
      />
      <ul className="mt-10 grid grid-cols-2 gap-5 lg:grid-cols-4">
        {templates.map((template) => (
          <li key={template.name}>
            <figure>
              {template.preview}
              <figcaption className="mt-4">
                <h3 className="font-sans text-lg font-bold">{template.name}</h3>
                <p className="text-muted mt-1 text-sm">{template.text}</p>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </Section>
  );
}
