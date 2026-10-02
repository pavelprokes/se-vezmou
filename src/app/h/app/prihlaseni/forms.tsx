"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import {
  confirmLinkAction,
  pinLoginAction,
  requestCodeAction,
  verifyCodeAction,
  type FormState,
} from "./actions";

/**
 * Formuláře přihlášení. Texty dostávají hotové ze serveru (`labels`), aby se do prohlížeče
 * nenačetly všechny překlady. Formuláře fungují i bez JavaScriptu (Server Actions); s ním
 * se po chybě zaměří chybné pole a čtečka oznámí chybu v živé oblasti (WCAG 3.3.1, 4.1.3).
 */

type Errors = Partial<Record<NonNullable<NonNullable<FormState>["error"]>, string>>;

function useFocusOnError(state: FormState, fieldId: string) {
  useEffect(() => {
    if (state?.error) document.getElementById(fieldId)?.focus();
  }, [state, fieldId]);
}

function Form({
  action,
  children,
  alert,
}: {
  action: (formData: FormData) => void;
  children: ReactNode;
  alert: ReactNode;
}) {
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormAlert>{alert}</FormAlert>
      {children}
    </form>
  );
}

function pauseText(template: string | undefined, state: FormState): string | undefined {
  return template?.replace("{pause}", state?.pause ?? "");
}

export function EmailForm({
  labels,
}: {
  labels: { email: string; hint: string; submit: string; errors: Errors };
}) {
  const [state, action, pending] = useActionState(requestCodeAction, null);
  useFocusOnError(state, "email");
  const fieldError = state?.error === "invalid_email" ? labels.errors.invalid_email : undefined;
  const formError = state?.error && !fieldError ? labels.errors[state.error] : undefined;
  return (
    <Form action={action} alert={formError}>
      <Field
        id="email"
        name="email"
        type="email"
        label={labels.email}
        hint={labels.hint}
        error={fieldError}
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        defaultValue={state?.value}
      />
      <Button type="submit" fullWidth disabled={pending} aria-disabled={pending || undefined}>
        {labels.submit}
      </Button>
    </Form>
  );
}

/**
 * Pole pro kód: obyčejné pole (ne šest oddělených políček), jde do něj vložit ze schránky
 * i z nápovědy správce hesel (WCAG 3.3.8). `inputMode="numeric"` otevře číselnou klávesnici,
 * `autoComplete="one-time-code"` nabídne kód z SMS i e-mailu.
 */
export function CodeForm({
  labels,
}: {
  labels: { code: string; hint: string; submit: string; errors: Errors };
}) {
  const [state, action, pending] = useActionState(verifyCodeAction, null);
  useFocusOnError(state, "code");
  const fieldError =
    state?.error === "format" || state?.error === "wrong" ? labels.errors[state.error] : undefined;
  const formError = state?.error && !fieldError ? labels.errors[state.error] : undefined;
  return (
    <Form action={action} alert={formError}>
      <Field
        id="code"
        name="code"
        type="text"
        label={labels.code}
        hint={labels.hint}
        error={fieldError}
        autoComplete="one-time-code"
        inputMode="numeric"
        pattern="[0-9 \-]*"
        autoCapitalize="none"
        spellCheck={false}
        required
      />
      <Button type="submit" fullWidth disabled={pending} aria-disabled={pending || undefined}>
        {labels.submit}
      </Button>
    </Form>
  );
}

export function LinkConfirmForm({
  token,
  labels,
}: {
  token: string;
  labels: { submit: string; errors: Errors };
}) {
  const [state, action, pending] = useActionState(confirmLinkAction, null);
  return (
    <Form action={action} alert={state?.error ? labels.errors[state.error] : undefined}>
      <input type="hidden" name="t" value={token} />
      <Button type="submit" fullWidth disabled={pending} aria-disabled={pending || undefined}>
        {labels.submit}
      </Button>
    </Form>
  );
}

export function PinForm({
  labels,
}: {
  labels: {
    slug: string;
    slugHint: string;
    pin: string;
    pinHint: string;
    submit: string;
    errors: Errors;
  };
}) {
  const [state, action, pending] = useActionState(pinLoginAction, null);
  useFocusOnError(state, "slug");
  const formError = state?.error
    ? state.error === "locked"
      ? pauseText(labels.errors.locked, state)
      : labels.errors[state.error]
    : undefined;
  return (
    <Form action={action} alert={formError}>
      <Field
        id="slug"
        name="slug"
        type="text"
        label={labels.slug}
        hint={labels.slugHint}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        defaultValue={state?.value}
      />
      <Field
        id="pin"
        name="pin"
        type="password"
        label={labels.pin}
        hint={labels.pinHint}
        autoComplete="current-password"
        inputMode="numeric"
        spellCheck={false}
        required
      />
      <Button type="submit" fullWidth disabled={pending} aria-disabled={pending || undefined}>
        {labels.submit}
      </Button>
    </Form>
  );
}
