"use client";

import { useActionState, useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";

/**
 * Společný obal formulářů operátorské administrace. Zásah je Server Action; výsledek se oznámí
 * čtečkám v živých oblastech (chyba `role="alert"`, úspěch `role="status"`, WCAG 4.1.3), po chybě se
 * zaměří chybné pole (3.3.1) a chyba je napsaná slovy (3.3.3). Formulář funguje i bez JavaScriptu.
 * Texty dostává ze serveru hotové (`errors`, `successText`), do prohlížeče se nenačítají překlady.
 */

export type ActionState<T = undefined> = {
  ok?: true;
  /** Klíč chyby (`error.<klíč>`); text zvolí formulář. */
  error?: string;
  /** Pole, u kterého chyba vznikla (jeho `name`); bez něj je to chyba celého formuláře. */
  field?: string;
  /** Zadané hodnoty, aby se po chybě nemusely psát znovu (nikdy tajné kódy). */
  values?: Record<string, string>;
  /** Výsledek zásahu k zobrazení pod formulářem (např. údaje hostů se souhlasem). */
  data?: T;
  /** Doplňková hodnota do hlášení (např. {pause}). */
  pause?: string;
} | null;

export type FormApi<T> = {
  state: ActionState<T>;
  /** Jedinečné `id` pole v rámci stránky (více formulářů má stejná jména polí). */
  id: (name: string) => string;
  /** Text chyby pro pole, jen když chyba patří právě jemu. */
  error: (name: string) => string | undefined;
  /** Hodnota pole po chybě. */
  value: (name: string) => string | undefined;
};

export function ActionForm<T = undefined>({
  action,
  submitLabel,
  successText,
  errors,
  children,
  below,
  className,
  hiddenFields,
  secondary,
  replaceOnSuccess,
}: {
  action: (previous: ActionState<T>, formData: FormData) => Promise<ActionState<T>>;
  submitLabel: string;
  successText?: string;
  errors: Record<string, string>;
  children: (api: FormApi<T>) => ReactNode;
  /** Výsledek zásahu (např. tabulka), vykreslí se pod formulářem. */
  below?: (state: ActionState<T>) => ReactNode;
  className?: string;
  hiddenFields?: Record<string, string>;
  /** Vedlejší tlačítko vedle odeslání (např. odstranění). */
  secondary?: ReactNode;
  /** Po úspěchu nahradí celý formulář (např. jednorázově zobrazené záložní kódy). */
  replaceOnSuccess?: (state: NonNullable<ActionState<T>>) => ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const id = (name: string) => `${uid}-${name}`;

  useEffect(() => {
    if (!state?.error) return;
    const target = state.field ? document.getElementById(id(state.field)) : null;
    (target ?? formRef.current?.querySelector<HTMLElement>("input, select, textarea"))?.focus();
    // `id` závisí jen na `uid`, který se nemění.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const message = state?.error ? (errors[state.error] ?? errors.generic) : undefined;
  const text = message?.replace("{pause}", state?.pause ?? "");
  const api: FormApi<T> = {
    state,
    id,
    error: (name) => (state?.error && state.field === name ? text : undefined),
    value: (name) => state?.values?.[name],
  };

  if (state?.ok && replaceOnSuccess)
    return <div className={className}>{replaceOnSuccess(state)}</div>;

  return (
    <div className={className}>
      <form ref={formRef} action={formAction} className="flex flex-col gap-4" noValidate>
        {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <FormAlert>{state?.error && !state.field ? text : undefined}</FormAlert>
        <div role="status" className="text-pine font-medium">
          {state?.ok && successText ? <p>{successText}</p> : null}
        </div>
        {children(api)}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending} aria-disabled={pending || undefined}>
            {submitLabel}
          </Button>
          {secondary}
        </div>
      </form>
      {below ? below(state) : null}
    </div>
  );
}
