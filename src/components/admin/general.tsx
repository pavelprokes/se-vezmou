"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { Checkbox, Radio } from "@/components/ui/choice";
import { Field, Fieldset } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { locales, type Locale } from "@/i18n/config";
import { pick } from "@/site/i18n-text";
import { templateKeys, templates, type TemplateKey } from "@/site/themes/palettes";
import { validateTemplatePalette } from "@/site/themes/validate";
import type { EditorDoc } from "@/admin/site/doc";
import { useAdminT } from "./i18n";

/**
 * Obecné: jména, datum, jazyky webu, šablona a barevná paleta (FR-ADM-1, FR-WEB-2, FR-WEB-3).
 * Dvojice šablona a paleta se kontroluje kontrastem WCAG 2.2 (`validatePalette`): paleta
 * s chybou se nedá zveřejnit.
 */
export function GeneralPanel({
  doc,
  uiLocale,
  update,
}: {
  doc: EditorDoc;
  uiLocale: Locale;
  update: (fn: (doc: EditorDoc) => EditorDoc) => void;
}) {
  const t = useAdminT();
  const w = doc.wedding;
  const setW = (patch: Partial<EditorDoc["wedding"]>) =>
    update((d) => ({ ...d, wedding: { ...d.wedding, ...patch } }));

  const toggleLocale = (locale: Locale, on: boolean) => {
    const next = on
      ? locales.filter((l) => w.locales.includes(l) || l === locale)
      : w.locales.filter((l) => l !== locale);
    if (next.length === 0) return;
    setW({
      locales: next,
      defaultLocale: next.includes(w.defaultLocale) ? w.defaultLocale : next[0],
    });
  };

  const palettes = templates[w.template].palettes;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("admin.general.partnerA")}
          autoComplete="off"
          value={w.partnerA}
          maxLength={100}
          onChange={(event) => setW({ partnerA: event.target.value })}
        />
        <Field
          label={t("admin.general.partnerB")}
          autoComplete="off"
          value={w.partnerB}
          maxLength={100}
          onChange={(event) => setW({ partnerB: event.target.value })}
        />
        <Field
          label={t("admin.general.startsOn")}
          type="date"
          autoComplete="off"
          value={w.startsOn}
          onChange={(event) => setW({ startsOn: event.target.value })}
        />
        <Field
          label={t("admin.general.endsOn")}
          hint={t("admin.general.endsOnHint")}
          type="date"
          autoComplete="off"
          value={w.endsOn ?? ""}
          min={w.startsOn || undefined}
          onChange={(event) => setW({ endsOn: event.target.value || null })}
        />
      </div>

      <Fieldset legend={t("admin.general.languages")}>
        <p className="text-muted text-sm">{t("admin.general.languagesHint")}</p>
        {locales.map((locale) => (
          <Checkbox
            key={locale}
            label={locale === "cs" ? t("admin.lang.cs") : t("admin.lang.en")}
            checked={w.locales.includes(locale)}
            disabled={w.locales.length === 1 && w.locales.includes(locale)}
            onChange={(event) => toggleLocale(locale, event.target.checked)}
          />
        ))}
      </Fieldset>

      {w.locales.length > 1 ? (
        <Fieldset legend={t("admin.general.defaultLocale")}>
          <p className="text-muted text-sm">{t("admin.general.defaultLocaleHint")}</p>
          {w.locales.map((locale) => (
            <Radio
              key={locale}
              name="default-locale"
              label={locale === "cs" ? t("admin.lang.cs") : t("admin.lang.en")}
              checked={w.defaultLocale === locale}
              onChange={() => setW({ defaultLocale: locale })}
            />
          ))}
        </Fieldset>
      ) : null}

      <Fieldset legend={t("admin.general.template")}>
        <p className="text-muted text-sm">{t("admin.general.templateHint")}</p>
        {templateKeys.map((key: TemplateKey) => (
          <Radio
            key={key}
            name="template"
            label={pick(templates[key].name, uiLocale)}
            checked={w.template === key}
            onChange={() => setW({ template: key, palette: templates[key].defaultPalette })}
          />
        ))}
      </Fieldset>

      <Fieldset legend={t("admin.general.palette")}>
        <p className="text-muted text-sm">{t("admin.general.paletteHint")}</p>
        {palettes.map((palette) => {
          const ok = validateTemplatePalette(w.template, palette.key).ok;
          return (
            <Radio
              key={palette.key}
              name="palette"
              checked={w.palette === palette.key}
              onChange={() => setW({ palette: palette.key })}
              label={
                <span className="flex flex-wrap items-center gap-2">
                  <span aria-hidden="true" className="flex">
                    {([palette.colors.bg, palette.colors.accent, palette.colors.text] as const).map(
                      (color, index) => (
                        <span
                          key={index}
                          className="border-field-border -ml-1 size-6 rounded-full border first:ml-0"
                          style={{ background: color }}
                        />
                      ),
                    )}
                  </span>
                  <span>{pick(palette.name, uiLocale)}</span>
                  {ok ? (
                    <span className="text-muted flex items-center gap-1 text-sm">
                      <Icon icon={CircleCheck} size={16} />
                      {t("admin.general.paletteOk")}
                    </span>
                  ) : (
                    <span className="text-cinnamon-deep flex items-center gap-1 text-sm font-medium">
                      <Icon icon={CircleAlert} size={16} />
                      {t("admin.general.paletteBad")}
                    </span>
                  )}
                </span>
              }
            />
          );
        })}
      </Fieldset>
    </div>
  );
}
