"use client";

import { useId, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { previewSlug } from "@/lib/slug-preview";
import type { Locale } from "@/i18n/config";
import { NAME_MAX_LENGTH, WIZARD_PARAMS, wizardPath } from "@/lib/wizard-link";
import { cn } from "@/lib/utils";

export interface NameFormLabels {
  first: string;
  second: string;
  firstPlaceholder: string;
  secondPlaceholder: string;
  /** Popisek náhledu adresy (jen u varianty `intro`). */
  address: string;
  submit: string;
  /** Přístupný název formuláře. */
  form: string;
}

export interface NameFormProps {
  /** Adresa průvodce z konfigurace (`NEXT_PUBLIC_APP_URL`). */
  appUrl: string;
  locale: Locale;
  /** Doména pro náhled adresy (`se-vezmou.cz`). */
  domain: string;
  labels: NameFormLabels;
  /** `intro`: světlá karta s náhledem adresy; `cta`: pole v řadě na tmavé skořicové ploše. */
  variant: "intro" | "cta";
}

/**
 * Pole se jmény páru, která předvyplní průvodce (FR-LP-5). Formulář je obyčejné GET na adresu
 * průvodce, takže funguje i bez JavaScriptu; skript jen skládá živý náhled adresy.
 * Pole nejsou povinná: bez jmen průvodce začne od prázdného formuláře.
 */
export function NameForm({ appUrl, locale, domain, labels, variant }: NameFormProps) {
  const id = useId();
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const cta = variant === "cta";

  const slug =
    previewSlug(first, second) ?? previewSlug(labels.firstPlaceholder, labels.secondPlaceholder);
  const typed = Boolean(previewSlug(first, second));

  const labelClass = cn("text-sm font-medium", cta ? "text-parchment" : "text-ink");
  const inputClass =
    "min-h-target rounded-button border-field-border bg-parchment text-ink w-full border-2 px-3 py-2 text-base placeholder:text-muted";

  return (
    <form
      action={`${appUrl}${wizardPath(locale)}`}
      method="get"
      aria-label={labels.form}
      className={cn(
        cta
          ? "flex w-full flex-col items-stretch gap-4 md:flex-row md:items-end"
          : "border-hairline flex flex-col gap-5 rounded-3xl border bg-white p-6 md:p-8",
      )}
    >
      <input type="hidden" name={WIZARD_PARAMS.locale} value={locale} />
      <div className={cn("grid gap-4", cta ? "flex-1 sm:grid-cols-2" : "sm:grid-cols-2")}>
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
            onChange={(event) => setFirst(event.target.value)}
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
            onChange={(event) => setSecond(event.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {cta ? null : (
        <div className="flex flex-col gap-1.5">
          <p className="text-ink text-sm font-medium">{labels.address}</p>
          <p
            data-testid="address-preview"
            className="bg-warm border-hairline text-ink rounded-button min-h-target flex items-center border px-3 py-2 font-sans text-base font-semibold break-all"
          >
            <span className={typed ? undefined : "text-muted"}>{slug}</span>
            <span className="text-cinnamon-deep">.{domain}</span>
          </p>
        </div>
      )}

      <button
        type="submit"
        className={cn(
          buttonVariants(),
          cta ? "border-ink bg-ink hover:border-pine hover:bg-pine" : "self-start",
        )}
      >
        {labels.submit}
      </button>
    </form>
  );
}
