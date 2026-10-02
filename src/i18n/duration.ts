import { intlLocale, type Locale } from "./config";
import { typo } from "./typo";

/** Délka (pauza, platnost) slovy ("15 minut", "24 hodin") podle `Intl`, s typografií. */
export function formatPause(seconds: number, locale: Locale): string {
  const [unit, value] =
    seconds >= 3600
      ? (["hour", Math.ceil(seconds / 3600)] as const)
      : (["minute", Math.max(1, Math.ceil(seconds / 60))] as const);
  return typo(
    new Intl.NumberFormat(intlLocale[locale], {
      style: "unit",
      unit,
      unitDisplay: "long",
    }).format(value),
    locale,
  );
}
