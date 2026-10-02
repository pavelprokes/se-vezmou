import type { Translator } from "@/i18n/translator";
import type { PinGateLabels } from "./pin-gate";

/** Hotové texty formuláře PINu (klient je dostane ze serveru, aby se nenačítaly všechny překlady). */
export function pinGateLabels(t: Translator, kind: "gifts" | "venue"): PinGateLabels {
  return {
    title: kind === "gifts" ? t("site.gifts.gateTitle") : t("site.venue.private.title"),
    body: kind === "gifts" ? t("site.gifts.gateBody") : t("site.venue.private.body"),
    label: t("site.gifts.pinLabel"),
    submit: t("site.gifts.pinSubmit"),
    hint: t("site.pin.hint"),
    sending: t("site.pin.sending"),
    errors: {
      format: t("site.pin.error.format"),
      invalid: t("site.pin.error.invalid"),
      locked: t("site.pin.error.locked", { pause: "{pause}" }),
      limited: t("site.pin.error.limited"),
      generic: t("site.pin.error.generic"),
    },
  };
}
