"use client";

import { ArrowRight } from "lucide-react";
import { useId, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/i18n/config";
import { NAME_MAX_LENGTH, WIZARD_PARAMS, wizardPath } from "@/lib/wizard-link";
import { cn } from "@/lib/utils";

export interface NameFormLabels {
  first: string;
  second: string;
  firstPlaceholder: string;
  secondPlaceholder: string;
  submit: string;
  /** Přístupný název formuláře. */
  form: string;
}

export interface Names {
  first: string;
  second: string;
}

export interface NameFormProps {
  /** Adresa průvodce z konfigurace (`NEXT_PUBLIC_APP_URL`). */
  appUrl: string;
  locale: Locale;
  labels: NameFormLabels;
  /** `hero`: pole na světlé ploše hera; `cta`: pole v řadě na tmavé skořicové ploše. */
  variant: "hero" | "cta";
  /** Řízená jména (hero je sdílí s živým náhledem webu); bez nich si formulář drží stav sám. */
  names?: Names;
  onNamesChange?: (names: Names) => void;
}

/**
 * Pole se jmény páru, která předvyplní průvodce (FR-LP-5). Formulář je obyčejné GET na adresu
 * průvodce, takže funguje i bez JavaScriptu; v heru skript navíc plní živý náhled webu.
 * Pole nejsou povinná: bez jmen průvodce začne od prázdného formuláře.
 */
export function NameForm({ appUrl, locale, labels, variant, names, onNamesChange }: NameFormProps) {
  const id = useId();
  const [own, setOwn] = useState<Names>({ first: "", second: "" });
  const { first, second } = names ?? own;
  const setNames = onNamesChange ?? setOwn;
  const cta = variant === "cta";

  const labelClass = cn("text-sm font-medium", cta ? "text-parchment" : "text-ink");
  const inputClass = cn(
    "min-h-target rounded-button border-field-border text-ink w-full border-2 px-3 py-2 text-base placeholder:text-muted",
    cta ? "bg-parchment" : "bg-white",
  );

  return (
    <form
      action={`${appUrl}${wizardPath(locale)}`}
      method="get"
      aria-label={labels.form}
      className={cn(
        "flex w-full flex-col gap-4",
        cta ? "items-stretch md:flex-row md:items-end" : "items-start",
      )}
    >
      <input type="hidden" name={WIZARD_PARAMS.locale} value={locale} />
      <div className="grid w-full flex-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-first`} className={labelClass}>
            {labels.first}
          </label>
          <input
            id={`${id}-first`}
            name={WIZARD_PARAMS.first}
            type="text"
            autoComplete="off"
            maxLength={NAME_MAX_LENGTH}
            placeholder={labels.firstPlaceholder}
            value={first}
            onChange={(event) => setNames({ first: event.target.value, second })}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-second`} className={labelClass}>
            {labels.second}
          </label>
          <input
            id={`${id}-second`}
            name={WIZARD_PARAMS.second}
            type="text"
            autoComplete="off"
            maxLength={NAME_MAX_LENGTH}
            placeholder={labels.secondPlaceholder}
            value={second}
            onChange={(event) => setNames({ first, second: event.target.value })}
            className={inputClass}
          />
        </div>
      </div>

      <button
        type="submit"
        className={cn(
          buttonVariants(),
          "shrink-0",
          cta && "border-ink bg-ink hover:border-pine hover:bg-pine",
        )}
      >
        {labels.submit}
        <Icon icon={ArrowRight} size={18} />
      </button>
    </form>
  );
}
