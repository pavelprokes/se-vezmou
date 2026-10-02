"use client";

import { EyeOff, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { pinProblem } from "@/auth/pin-format";
import { PIN_LENGTH } from "@/auth/config";
import { ScreenGroup, TextField, ToggleField, useErrorText } from "../fields";
import { useT } from "../i18n";
import type { StepProps } from "./types";

/** Náhodný PIN o šesti číslicích z kryptografického generátoru prohlížeče, bez triviálních hodnot. */
export function generatePin(): string {
  for (;;) {
    const values = globalThis.crypto.getRandomValues(new Uint32Array(PIN_LENGTH.min));
    const pin = Array.from(values, (value) => String(value % 10)).join("");
    if (pinProblem(pin) === null) return pin;
  }
}

/** Krok 7: přístup a soukromí. Web se nikdy neindexuje; PIN hostů je volitelná ochrana citlivých částí. */
export function StepAccess({ draft, update, errors, screen, mobile }: StepProps) {
  const t = useT();
  const errorText = useErrorText();
  const { guestPin } = draft;

  const setEnabled = (enabled: boolean) =>
    update((d) => ({
      ...d,
      guestPin: { enabled, pin: enabled && d.guestPin.pin === "" ? generatePin() : d.guestPin.pin },
    }));

  return (
    <ScreenGroup index={0} screen={screen} mobile={mobile}>
      <section aria-labelledby="wz-noindex" className="bg-linen rounded-2xl p-4">
        <h3 id="wz-noindex" className="flex items-center gap-2 text-lg font-medium">
          <Icon icon={EyeOff} size={22} />
          {t("wizard.access.noindex.title")}
        </h3>
        <p className="mt-2">{t("wizard.access.noindex.body")}</p>
        <p className="text-muted mt-2 text-sm">{t("wizard.access.noindex.note")}</p>
      </section>

      <section aria-labelledby="wz-pin" className="flex flex-col gap-4">
        <h3 id="wz-pin" className="flex items-center gap-2 text-lg font-medium">
          <Icon icon={ShieldCheck} size={22} />
          {t("wizard.access.pin.title")}
        </h3>
        <p>{t("wizard.access.pin.body")}</p>
        <ToggleField
          label={t("wizard.access.pin.enable")}
          description={t("wizard.access.pin.enableHint")}
          checked={guestPin.enabled}
          onCheckedChange={setEnabled}
        />
        {guestPin.enabled ? (
          <>
            <TextField
              field="pin"
              type="text"
              inputMode="numeric"
              label={t("wizard.access.pin.label")}
              hint={t("wizard.access.pin.hint", { min: PIN_LENGTH.min, max: PIN_LENGTH.max })}
              value={guestPin.pin}
              onValueChange={(pin) =>
                update((d) => ({
                  ...d,
                  guestPin: { ...d.guestPin, pin: pin.replace(/[^0-9]/g, "") },
                }))
              }
              error={errorText(errors, "pin")}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={PIN_LENGTH.max}
              required
            />
            <Button
              variant="secondary"
              className="self-start"
              onClick={() =>
                update((d) => ({ ...d, guestPin: { ...d.guestPin, pin: generatePin() } }))
              }
            >
              {t("wizard.access.pin.generate")}
            </Button>
            <p className="text-muted text-sm">{t("wizard.access.pin.storage")}</p>
          </>
        ) : null}
      </section>
    </ScreenGroup>
  );
}
