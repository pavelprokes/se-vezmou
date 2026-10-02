"use client";

import { CircleCheck } from "lucide-react";
import { Fieldset } from "@/components/ui/field";
import { Radio } from "@/components/ui/choice";
import { Icon } from "@/components/ui/icon";
import { pick } from "@/site/i18n-text";
import { templateKeys, templates, type Palette } from "@/site/themes/palettes";
import { validatePalette } from "@/site/themes/validate";
import { withTemplate } from "@/wizard/draft";
import { ScreenGroup, useErrorText } from "../fields";
import { useT, type WizardKey } from "./../i18n";
import type { StepProps } from "./types";

/** Čtverečky hlavních barev palety: jen ukázka, význam nese název (WCAG 1.4.1). */
function Swatches({ palette }: { palette: Palette }) {
  const { colors } = palette;
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 overflow-hidden rounded-md border border-black/20"
    >
      {[colors.bg, colors.surface, colors.accent, colors.accent2, colors.text].map(
        (color, index) => (
          <span key={index} className="block h-7 w-5" style={{ backgroundColor: color }} />
        ),
      )}
    </span>
  );
}

/** Krok 3: šablona a paleta. Paleta s nízkým kontrastem se nikdy nenabídne bez upozornění. */
export function StepTemplate({ draft, update, errors, screen, mobile }: StepProps) {
  const t = useT();
  const errorText = useErrorText();
  const definition = templates[draft.template];
  const locale = t.locale;

  return (
    <>
      <ScreenGroup index={0} screen={screen} mobile={mobile}>
        <Fieldset legend={t("wizard.template.legend")}>
          <p className="text-muted mb-2 text-sm">{t("wizard.template.hint")}</p>
          <div className="flex flex-col gap-2">
            {templateKeys.map((key) => (
              <Radio
                key={key}
                name="wz-template"
                checked={draft.template === key}
                onChange={() => update((d) => withTemplate(d, key))}
                label={
                  <span className="flex flex-col">
                    <span className="font-semibold">{pick(templates[key].name, locale)}</span>
                    <span className="text-muted text-sm">
                      {t(`wizard.template.${key}.description` as WizardKey)}
                    </span>
                  </span>
                }
              />
            ))}
          </div>
        </Fieldset>
      </ScreenGroup>

      <ScreenGroup index={1} screen={screen} mobile={mobile}>
        <Fieldset legend={t("wizard.palette.legend")} error={errorText(errors, "palette")}>
          <p className="text-muted mb-2 text-sm">
            {t("wizard.palette.hint", { template: pick(definition.name, locale) })}
          </p>
          <div className="flex flex-col gap-2">
            {definition.palettes.map((palette) => {
              const ok = validatePalette(palette).ok;
              return (
                <Radio
                  key={palette.key}
                  name="wz-palette"
                  checked={draft.palette === palette.key}
                  onChange={() => update((d) => ({ ...d, palette: palette.key }))}
                  label={
                    <span className="flex items-center gap-3">
                      <Swatches palette={palette} />
                      <span className="font-semibold">{pick(palette.name, locale)}</span>
                      {ok ? null : (
                        <span className="text-cinnamon-deep text-sm">
                          {t("wizard.palette.lowContrast")}
                        </span>
                      )}
                    </span>
                  }
                />
              );
            })}
          </div>
        </Fieldset>
        <p className="text-muted flex items-start gap-2 text-sm">
          <Icon icon={CircleCheck} size={18} className="mt-0.5 shrink-0" />
          <span>{t("wizard.palette.contrastNote")}</span>
        </p>
      </ScreenGroup>
    </>
  );
}
