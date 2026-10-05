"use client";

import { useId, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/choice";
import { Explainer } from "@/components/ui/explainer";
import { Field, type FieldProps } from "@/components/ui/field";
import { TextArea } from "@/components/ui/textarea";
import type { Locale } from "@/i18n/config";
import type { IssueCode } from "@/wizard/draft";
import type { I18nText } from "@/site/i18n-text";
import { useT, type WizardKey } from "./i18n";

/** Prefix identifikátorů polí průvodce; podle něj se po chybě zaměří první chybné pole. */
export const FIELD_PREFIX = "wz-";

export function fieldId(field: string): string {
  return `${FIELD_PREFIX}${field}`;
}

/**
 * Zaměří prvek po překreslení. Po „Odebrat“ zmizí tlačítko, které mělo fokus, a fokus by spadl
 * na `body` (WCAG 2.4.3); proto se přesune na tlačítko „Přidat…“ téže skupiny.
 */
export function focusLater(id: string): void {
  setTimeout(() => document.getElementById(id)?.focus(), 0);
}

/** Chyby k zobrazení: pole -> kód chyby (po pokusu o pokračování nebo uložení). */
export type FieldErrors = ReadonlyMap<string, IssueCode>;

export function useErrorText() {
  const t = useT();
  return (errors: FieldErrors, field: string): string | undefined => {
    const code = errors.get(field);
    return code ? t(`wizard.issue.${code}` as WizardKey) : undefined;
  };
}

/**
 * Skupina otázek jedné „obrazovky“ kroku. Na mobilu je vidět jen aktivní skupina (jedna otázka
 * nebo malá skupina na obrazovku, FR-WZ-7); na větším displeji jsou vidět všechny. Skryté skupiny
 * zůstávají v DOM, takže si pole drží hodnoty.
 */
export function ScreenGroup({
  index,
  screen,
  mobile,
  children,
}: {
  index: number;
  screen: number;
  mobile: boolean;
  children: ReactNode;
}) {
  return (
    <div hidden={mobile && index !== screen} className="flex flex-col gap-6">
      {children}
    </div>
  );
}

/** Textové pole, které při změně vrací jen novou hodnotu. */
export function TextField({
  field,
  value,
  onValueChange,
  error,
  ...rest
}: Omit<FieldProps, "id" | "value" | "onChange" | "error"> & {
  field: string;
  value: string;
  onValueChange: (value: string) => void;
  error?: ReactNode;
}) {
  return (
    <Field
      {...rest}
      id={fieldId(field)}
      value={value}
      error={error}
      onChange={(event) => onValueChange(event.target.value)}
    />
  );
}

/** Text po jazycích: pole pro hlavní jazyk webu a (u dvojjazyčného webu) nepovinný překlad. */
export function LocalizedTextArea({
  field,
  label,
  hint,
  value,
  onValueChange,
  siteLocales,
  defaultLocale,
  maxLength,
  rows,
  error,
}: {
  field: string;
  label: ReactNode;
  hint?: ReactNode;
  value: I18nText;
  onValueChange: (next: I18nText) => void;
  siteLocales: readonly Locale[];
  defaultLocale: Locale;
  maxLength: number;
  rows?: number;
  error?: ReactNode;
}) {
  const t = useT();
  const others = siteLocales.filter((locale) => locale !== defaultLocale);
  const set = (locale: Locale, text: string) => {
    const next: I18nText = { ...value, [locale]: text };
    if (text === "") delete next[locale];
    onValueChange(next);
  };
  return (
    <div className="flex flex-col gap-4">
      <TextArea
        id={fieldId(field)}
        label={label}
        hint={hint}
        error={error}
        rows={rows}
        maxLength={maxLength}
        lang={defaultLocale}
        value={value[defaultLocale] ?? ""}
        onChange={(event) => set(defaultLocale, event.target.value)}
      />
      {others.map((locale) => (
        <TextArea
          key={locale}
          id={fieldId(`${field}-${locale}`)}
          label={t("wizard.localized.other", { language: t(`wizard.language.${locale}`) })}
          hint={t("wizard.localized.otherHint")}
          rows={rows}
          maxLength={maxLength}
          lang={locale}
          value={value[locale] ?? ""}
          onChange={(event) => set(locale, event.target.value)}
        />
      ))}
    </div>
  );
}

/** Jedno přepínací pole s popiskem a vysvětlením pod ním (připojeným přes `aria-describedby`). */
export function ToggleField({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const descriptionId = useId();
  return (
    <div className="flex flex-col">
      <Checkbox
        label={label}
        checked={checked}
        aria-describedby={description ? descriptionId : undefined}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      {description ? (
        <p id={descriptionId} className="text-muted ps-9 text-sm">
          {description}
        </p>
      ) : null}
    </div>
  );
}

/** Vysvětlivky pojmů průvodce: krátký nadpis-otázka a text po odstavcích (`\n\n`). */
const EXPLAIN_KEYS = {
  address: { title: "wizard.explain.address.title", body: "wizard.explain.address.body" },
  draft: { title: "wizard.explain.draft.title", body: "wizard.explain.draft.body" },
  preview: { title: "wizard.explain.preview.title", body: "wizard.explain.preview.body" },
  pin: { title: "wizard.explain.pin.title", body: "wizard.explain.pin.body" },
  rsvp: { title: "wizard.explain.rsvp.title", body: "wizard.explain.rsvp.body" },
  email: { title: "wizard.explain.email.title", body: "wizard.explain.email.body" },
  map: { title: "wizard.explain.map.title", body: "wizard.explain.map.body" },
  skip: { title: "wizard.explain.skip.title", body: "wizard.explain.skip.body" },
} as const satisfies Record<string, { title: WizardKey; body: WizardKey }>;

export type ExplainTopic = keyof typeof EXPLAIN_KEYS;

/** Vysvětlivka pojmu průvodce („Co je adresa webu?“), rozbalovací pod polem, kterého se týká. */
export function Explain({ topic, className }: { topic: ExplainTopic; className?: string }) {
  const t = useT();
  return (
    <Explainer title={t(EXPLAIN_KEYS[topic].title)} className={className}>
      {t(EXPLAIN_KEYS[topic].body)
        .split("\n\n")
        .map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
    </Explainer>
  );
}
