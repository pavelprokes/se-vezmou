"use client";

import { useState } from "react";
import { Explain, ToggleField, ScreenGroup, TextField, useErrorText } from "../fields";
import { useT } from "../i18n";
import { SlugField, type SlugConflict } from "../slug-field";
import type { StepProps } from "./types";

/** Krok 2: datum svatby a adresa webu. */
export function StepDate({
  draft,
  update,
  errors,
  screen,
  mobile,
  domain,
  conflict,
  onDismissConflict,
}: StepProps & {
  domain: string;
  conflict: SlugConflict | null;
  onDismissConflict: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [multiDay, setMultiDay] = useState(draft.endsOn !== "");

  return (
    <>
      <ScreenGroup index={0} screen={screen} mobile={mobile}>
        <TextField
          field="startsOn"
          type="date"
          label={multiDay ? t("wizard.date.first.label") : t("wizard.date.label")}
          hint={t("wizard.date.hint")}
          value={draft.startsOn}
          onValueChange={(value) => update((d) => ({ ...d, startsOn: value }))}
          error={errorText(errors, "startsOn")}
          autoComplete="off"
          required
        />
        <ToggleField
          label={t("wizard.date.multiDay")}
          checked={multiDay}
          onCheckedChange={(on) => {
            setMultiDay(on);
            if (!on) update((d) => ({ ...d, endsOn: "" }));
          }}
        />
        {multiDay ? (
          <TextField
            field="endsOn"
            type="date"
            label={t("wizard.date.last.label")}
            hint={t("wizard.date.last.hint")}
            value={draft.endsOn}
            min={draft.startsOn || undefined}
            onValueChange={(value) => update((d) => ({ ...d, endsOn: value }))}
            error={errorText(errors, "endsOn")}
            autoComplete="off"
          />
        ) : null}
      </ScreenGroup>

      <ScreenGroup index={1} screen={screen} mobile={mobile}>
        <SlugField
          draft={draft}
          domain={domain}
          error={errorText(errors, "slug")}
          conflict={conflict}
          onDismissConflict={onDismissConflict}
          onSlugChange={(slug, edited) => update((d) => ({ ...d, slug, slugEdited: edited }))}
        />
        <Explain topic="address" />
      </ScreenGroup>
    </>
  );
}
