"use client";

import { Fieldset } from "@/components/ui/field";
import { Radio, Checkbox } from "@/components/ui/choice";
import { locales, type Locale } from "@/i18n/config";
import { withLocales, withNames } from "@/wizard/draft";
import { fieldId, ScreenGroup, TextField, useErrorText } from "../fields";
import { useT } from "../i18n";
import type { StepProps } from "./types";

/** Krok 1: jména a jazyk webu. */
export function StepNames({ draft, update, errors, screen, mobile }: StepProps) {
  const t = useT();
  const errorText = useErrorText();

  const toggleLocale = (locale: Locale, on: boolean) =>
    update((d) =>
      withLocales(
        d,
        on ? [...d.locales, locale] : d.locales.filter((l) => l !== locale),
        d.defaultLocale,
      ),
    );

  return (
    <>
      <ScreenGroup index={0} screen={screen} mobile={mobile}>
        <TextField
          field="partnerA"
          label={t("wizard.names.first.label")}
          hint={t("wizard.names.first.hint")}
          value={draft.partnerA}
          onValueChange={(value) => update((d) => withNames(d, value, d.partnerB))}
          error={errorText(errors, "partnerA")}
          autoComplete="off"
          maxLength={60}
          required
        />
        <TextField
          field="partnerB"
          label={t("wizard.names.second.label")}
          hint={t("wizard.names.second.hint")}
          value={draft.partnerB}
          onValueChange={(value) => update((d) => withNames(d, d.partnerA, value))}
          error={errorText(errors, "partnerB")}
          autoComplete="off"
          maxLength={60}
          required
        />
      </ScreenGroup>

      <ScreenGroup index={1} screen={screen} mobile={mobile}>
        <Fieldset
          id={fieldId("locales")}
          legend={t("wizard.locales.legend")}
          hint={t("wizard.locales.hint")}
          error={errorText(errors, "locales")}
        >
          {locales.map((locale) => (
            <Checkbox
              key={locale}
              id={`wz-locale-${locale}`}
              label={t(`wizard.language.${locale}`)}
              checked={draft.locales.includes(locale)}
              // poslední jazyk nejde odškrtnout (web musí mít aspoň jeden), proč říká nápověda skupiny
              disabled={draft.locales.length === 1 && draft.locales.includes(locale)}
              onChange={(event) => toggleLocale(locale, event.target.checked)}
            />
          ))}
        </Fieldset>

        {draft.locales.length > 1 ? (
          <Fieldset
            legend={t("wizard.locales.default.legend")}
            hint={t("wizard.locales.default.hint")}
          >
            {draft.locales.map((locale) => (
              <Radio
                key={locale}
                name="wz-default-locale"
                label={t(`wizard.language.${locale}`)}
                checked={draft.defaultLocale === locale}
                onChange={() => update((d) => withLocales(d, d.locales, locale))}
              />
            ))}
          </Fieldset>
        ) : null}
      </ScreenGroup>
    </>
  );
}
