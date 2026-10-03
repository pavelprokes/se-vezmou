"use client";

import { CircleAlert, Languages, Plus, Trash2 } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { TextArea } from "@/components/ui/textarea";
import type { Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import type { I18nText } from "@/site/i18n-text";
import { useAdminT } from "./i18n";

/** Pomocné prvky editoru: text po jazycích, přidání a odebrání položky. */

function filled(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

/**
 * Text po jazycích webu (FR-WEB-2): pro každý jazyk jedno pole s viditelným popiskem, `lang`
 * podle jazyka textu (WCAG 3.1.2). Když je text vyplněný jen v části jazyků, pod polem je
 * upozornění slovy i ikonou (ne jen barvou): na webu se pak zobrazí dostupný jazyk.
 */
export function LocalizedField({
  label,
  hint,
  value,
  locales,
  onChange,
  multiline = false,
  rows = 3,
  maxLength,
  required = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: I18nText | null | undefined;
  locales: readonly Locale[];
  onChange: (next: I18nText | null) => void;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  required?: boolean;
}) {
  const t = useAdminT();
  const id = useId();
  const anyFilled = locales.some((locale) => filled(value?.[locale]));
  const missing = anyFilled ? locales.filter((locale) => !filled(value?.[locale])) : [];

  const set = (locale: Locale, text: string) => {
    const next: I18nText = { ...value, [locale]: text };
    onChange(Object.values(next).some((v) => filled(v)) ? next : null);
  };

  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby={missing.length > 0 ? `${id}-missing` : undefined}
    >
      <legend className="text-ink font-medium">
        {label}
        {required ? (
          <span className="text-muted font-normal"> ({t("admin.field.required")})</span>
        ) : null}
      </legend>
      {hint ? <p className="text-muted text-sm">{hint}</p> : null}
      {locales.map((locale, position) => {
        const name = locale === "cs" ? t("admin.lang.cs") : t("admin.lang.en");
        const common = {
          label: name,
          lang: locale,
          value: value?.[locale] ?? "",
          maxLength,
          // Povinný je aspoň jeden jazyk: příznak nese první pole, aby čtečka nehlásila povinné obě.
          "aria-required": required && position === 0 ? true : undefined,
        };
        return multiline ? (
          <TextArea
            key={locale}
            {...common}
            rows={rows}
            onChange={(event) => set(locale, event.target.value)}
          />
        ) : (
          <Field key={locale} {...common} onChange={(event) => set(locale, event.target.value)} />
        );
      })}
      <div aria-live="polite">
        {missing.length > 0 ? (
          <p id={`${id}-missing`} className="text-cinnamon-deep flex items-start gap-2 text-sm">
            <Icon icon={Languages} size={18} className="mt-0.5" />
            <span>
              {t("admin.translation.inline", {
                languages: missing
                  .map((locale) => (locale === "cs" ? t("admin.lang.cs") : t("admin.lang.en")))
                  .join(", "),
              })}
            </span>
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}

/** Tlačítko pro přidání položky seznamu (název nese, co se přidá). */
export function AddButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button type="button" variant="secondary" onClick={onClick} disabled={disabled}>
      <Icon icon={Plus} />
      {children}
    </Button>
  );
}

/** Odebrání položky: popisek obsahuje pořadí, aby se tlačítka ve čtečce nelišila jen polohou. */
export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="text" onClick={onClick} aria-label={label}>
      <Icon icon={Trash2} />
      <span className="max-sm:sr-only">{label}</span>
    </Button>
  );
}

/** Jedna položka seznamu (událost, místo, otázka) jako skupina s nadpisem a odebráním. */
export function ItemCard({
  title,
  onRemove,
  removeLabel,
  children,
  id,
}: {
  title: string;
  onRemove: () => void;
  removeLabel: string;
  children: ReactNode;
  id?: string;
}) {
  const heading = useId();
  return (
    <div
      id={id}
      role="group"
      aria-labelledby={heading}
      className="border-hairline bg-parchment flex flex-col gap-4 rounded-2xl border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={heading} className="text-ink font-sans text-base font-semibold">
          {title}
        </h4>
        <RemoveButton label={removeLabel} onClick={onRemove} />
      </div>
      {children}
    </div>
  );
}

/** Chyba nebo upozornění k položce: text s ikonou, ne jen barva (WCAG 1.4.1). */
export function Note({
  children,
  tone = "warning",
  id,
}: {
  children: ReactNode;
  tone?: "warning" | "info";
  id?: string;
}) {
  return (
    <p
      id={id}
      className={cn(
        "flex items-start gap-2 text-sm",
        tone === "warning" ? "text-cinnamon-deep font-medium" : "text-muted",
      )}
    >
      <Icon icon={CircleAlert} size={18} className="mt-0.5" />
      <span>{children}</span>
    </p>
  );
}

/** Nativní výběr s viditelným popiskem. */
export function SelectField({
  label,
  value,
  onChange,
  children,
  hint,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-ink font-medium">
        {label}
      </label>
      {hint ? <p className="text-muted text-sm">{hint}</p> : null}
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-target rounded-button bg-parchment text-ink border-field-border w-full border-2 px-3 py-2 text-base"
      >
        {children}
      </select>
    </div>
  );
}
