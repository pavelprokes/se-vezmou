"use client";

import { Fieldset } from "@/components/ui/field";
import { Explain, ScreenGroup, TextField, ToggleField, useErrorText } from "../fields";
import { useT } from "../i18n";
import type { StepProps } from "./types";

/** Krok 6: nastavení potvrzení účasti (uzávěrka a vestavěné otázky). */
export function StepRsvp({ draft, update, errors, screen, mobile }: StepProps) {
  const t = useT();
  const errorText = useErrorText();
  const { rsvp } = draft;
  const patch = (change: Partial<typeof rsvp>) =>
    update((d) => ({ ...d, rsvp: { ...d.rsvp, ...change } }));

  return (
    <>
      <ScreenGroup index={0} screen={screen} mobile={mobile}>
        <TextField
          field="deadline"
          type="date"
          label={t("wizard.rsvp.deadline.label")}
          hint={t("wizard.rsvp.deadline.hint")}
          value={rsvp.deadline}
          max={draft.startsOn || undefined}
          onValueChange={(deadline) => patch({ deadline })}
          error={errorText(errors, "deadline")}
          autoComplete="off"
        />
      </ScreenGroup>

      <ScreenGroup index={1} screen={screen} mobile={mobile}>
        <Fieldset legend={t("wizard.rsvp.questions.legend")} hint={t("wizard.rsvp.questions.hint")}>
          <ToggleField
            label={t("wizard.rsvp.plusOne")}
            description={t("wizard.rsvp.plusOneHint")}
            checked={rsvp.plusOne}
            onCheckedChange={(plusOne) => patch({ plusOne })}
          />
          <ToggleField
            label={t("wizard.rsvp.children")}
            checked={rsvp.children}
            onCheckedChange={(children) => patch({ children })}
          />
          <ToggleField
            label={t("wizard.rsvp.diet")}
            description={t("wizard.rsvp.dietHint")}
            checked={rsvp.diet}
            onCheckedChange={(diet) => patch({ diet })}
          />
          <ToggleField
            label={t("wizard.rsvp.emailConfirmation")}
            description={t("wizard.rsvp.emailConfirmationHint")}
            checked={rsvp.emailConfirmation}
            onCheckedChange={(emailConfirmation) => patch({ emailConfirmation })}
          />
        </Fieldset>
        <p className="text-muted text-sm">{t("wizard.rsvp.later")}</p>
        <Explain topic="rsvp" />
      </ScreenGroup>
    </>
  );
}
