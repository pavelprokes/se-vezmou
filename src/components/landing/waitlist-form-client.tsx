"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { useActionState, useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Icon } from "@/components/ui/icon";
import { HONEYPOT_FIELD } from "@/lib/waitlist-fields";
import { joinWaitlist } from "./waitlist-action";
import { initialWaitlistState } from "./waitlist-state";

export interface WaitlistLabels {
  email: string;
  consent: string;
  submit: string;
  pending: string;
  success: string;
  honeypot: string;
  errors: {
    emailRequired: string;
    emailInvalid: string;
    consentRequired: string;
    rateLimited: string;
    generic: string;
  };
}

/**
 * Formulář čekací listiny (e-mail a souhlas) přes Server Action a `useActionState`, takže funguje
 * i bez JavaScriptu. Chyby u polí jsou v `aria-live`, výsledek celého odeslání ve vlastní živé oblasti.
 * `noValidate`: chyby ukazuje server jednotně a přístupně, ne bublina prohlížeče.
 */
export function WaitlistFormClient({ locale, labels }: { locale: string; labels: WaitlistLabels }) {
  const [state, action, pending] = useActionState(joinWaitlist, initialWaitlistState);
  const consentId = useId();
  const consentErrorId = `${consentId}-error`;
  const formRef = useRef<HTMLFormElement>(null);

  const emailError =
    state.errors?.email === "required"
      ? labels.errors.emailRequired
      : state.errors?.email === "invalid"
        ? labels.errors.emailInvalid
        : undefined;
  const consentError = state.errors?.consent ? labels.errors.consentRequired : undefined;
  const formError =
    state.status === "rateLimited"
      ? labels.errors.rateLimited
      : state.status === "error"
        ? labels.errors.generic
        : undefined;

  // Po chybě se zaměří první chybné pole (3.3.1); bez chybného pole zůstane zaměření na tlačítku,
  // které se během odesílání jen označuje `aria-disabled`, takže ho neztratí.
  useEffect(() => {
    if (state.status === "idle" || state.status === "success") return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={(event) => {
        // Dvojité odeslání během čekání zahodit (tlačítko není `disabled`, aby neztratilo zaměření).
        if (pending) event.preventDefault();
      }}
      noValidate
      className="mt-5 flex flex-col gap-4"
    >
      <input type="hidden" name="locale" value={locale} />
      {/* Past na roboty: člověk pole nevidí ani nezaměří; vyplněné pole zahodí odeslání. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          {labels.honeypot}
          <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <Field
        label={labels.email}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        defaultValue={state.email}
        error={emailError}
      />

      <div>
        <Checkbox
          name="consent"
          label={labels.consent}
          aria-invalid={consentError ? true : undefined}
          aria-describedby={consentError ? consentErrorId : undefined}
        />
        <div aria-live="polite">
          {consentError ? (
            <p
              id={consentErrorId}
              className="text-cinnamon-deep flex items-start gap-2 text-sm font-medium"
            >
              <Icon icon={CircleAlert} size={18} className="mt-0.5" />
              <span>{consentError}</span>
            </p>
          ) : null}
        </div>
      </div>

      <div>
        <Button type="submit" aria-disabled={pending || undefined}>
          {pending ? labels.pending : labels.submit}
        </Button>
      </div>

      {/* Výsledek odeslání: oblast je v DOM stále, aby čtečky novou zprávu oznámily. */}
      <div aria-live="polite" role="status">
        {state.status === "success" ? (
          <p className="text-pine flex items-start gap-2 font-medium">
            <Icon icon={CircleCheck} size={20} className="mt-0.5" />
            <span>{labels.success}</span>
          </p>
        ) : null}
      </div>
      {/* Chyba celého formuláře (omezení počtu požadavků, selhání): `role="alert"` je v DOM stále. */}
      <FormAlert>{formError}</FormAlert>
    </form>
  );
}
