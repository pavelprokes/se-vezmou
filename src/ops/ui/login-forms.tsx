"use client";

import { Field } from "@/components/ui/field";
import {
  enrollAction,
  regenerateCodesAction,
  requestOperatorCodeAction,
  secondFactorAction,
  verifyOperatorCodeAction,
  type CodesData,
} from "../actions/login";
import { ActionForm } from "./action-form";

/**
 * Formuláře přihlášení operátora (WCAG 3.3.8: pole jsou obyčejná, jde do nich vkládat ze schránky
 * i ze správce hesel, žádné hádanky, opisování obrázků ani rozpoznávání předmětů). Kód z e-mailu
 * i kód z aplikace jsou ve stejném poli jako číslice; `autoComplete="one-time-code"` nabídne kód
 * z e-mailu a `inputMode="numeric"` otevře číselnou klávesnici.
 */

type Errors = Record<string, string>;

export function OperatorEmailForm({
  labels,
}: {
  labels: { email: string; hint: string; submit: string; errors: Errors };
}) {
  return (
    <ActionForm
      action={requestOperatorCodeAction}
      submitLabel={labels.submit}
      errors={labels.errors}
    >
      {(form) => (
        <Field
          id={form.id("email")}
          name="email"
          type="email"
          label={labels.email}
          hint={labels.hint}
          error={form.error("email")}
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={form.value("email")}
        />
      )}
    </ActionForm>
  );
}

export function OperatorCodeForm({
  labels,
}: {
  labels: { code: string; hint: string; submit: string; errors: Errors };
}) {
  return (
    <ActionForm
      action={verifyOperatorCodeAction}
      submitLabel={labels.submit}
      errors={labels.errors}
    >
      {(form) => (
        <Field
          id={form.id("code")}
          name="code"
          type="text"
          label={labels.code}
          hint={labels.hint}
          error={form.error("code")}
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9 \-]*"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
      )}
    </ActionForm>
  );
}

/** Jedno pole pro kód z aplikace (6 číslic) i záložní kód (10 znaků); podle tvaru se pozná, o který jde. */
export function SecondFactorForm({
  labels,
}: {
  labels: { code: string; hint: string; submit: string; errors: Errors };
}) {
  return (
    <ActionForm action={secondFactorAction} submitLabel={labels.submit} errors={labels.errors}>
      {(form) => (
        <Field
          id={form.id("code")}
          name="code"
          type="text"
          label={labels.code}
          hint={labels.hint}
          error={form.error("code")}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          required
        />
      )}
    </ActionForm>
  );
}

export function BackupCodesList({ codes, label }: { codes: readonly string[]; label: string }) {
  return (
    <ul
      aria-label={label}
      className="bg-parchment border-hairline rounded-button grid grid-cols-1 gap-2 border p-4 font-mono text-lg sm:grid-cols-2"
    >
      {codes.map((code) => (
        <li key={code}>{code}</li>
      ))}
    </ul>
  );
}

/** Zápis druhého faktoru: po potvrzení kódem se formulář nahradí jednorázově zobrazenými záložními kódy. */
export function EnrollForm({
  labels,
}: {
  labels: {
    code: string;
    hint: string;
    submit: string;
    errors: Errors;
    codesTitle: string;
    codesIntro: string;
    codesList: string;
    continue: string;
    /** Úvod administrace v jazyce stránky (`/`, `/en`). */
    continueHref: string;
  };
}) {
  return (
    <ActionForm<CodesData>
      action={enrollAction}
      submitLabel={labels.submit}
      errors={labels.errors}
      replaceOnSuccess={(state) => (
        <div className="flex flex-col gap-4">
          <h2 className="text-ink text-2xl font-medium">{labels.codesTitle}</h2>
          <p>{labels.codesIntro}</p>
          <BackupCodesList codes={state.data?.codes ?? []} label={labels.codesList} />
          <p>
            <a
              href={labels.continueHref}
              className="min-h-target rounded-button border-pine bg-pine text-parchment hover:border-ink hover:bg-ink inline-flex items-center justify-center border-2 px-5 py-2 font-medium"
            >
              {labels.continue}
            </a>
          </p>
        </div>
      )}
    >
      {(form) => (
        <Field
          id={form.id("code")}
          name="code"
          type="text"
          label={labels.code}
          hint={labels.hint}
          error={form.error("code")}
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9 \-]*"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
      )}
    </ActionForm>
  );
}

/** Nová sada záložních kódů v nastavení účtu. */
export function RegenerateCodesForm({
  labels,
}: {
  labels: {
    submit: string;
    errors: Errors;
    codesTitle: string;
    codesIntro: string;
    codesList: string;
    code: string;
    hint: string;
  };
}) {
  return (
    <ActionForm<CodesData>
      action={regenerateCodesAction}
      submitLabel={labels.submit}
      errors={labels.errors}
      below={(state) =>
        state?.ok ? (
          <div className="mt-4 flex flex-col gap-3" role="status">
            <h3 className="text-ink text-xl font-medium">{labels.codesTitle}</h3>
            <p>{labels.codesIntro}</p>
            <BackupCodesList codes={state.data?.codes ?? []} label={labels.codesList} />
          </div>
        ) : null
      }
    >
      {(form) => (
        <Field
          id={form.id("code")}
          name="code"
          type="text"
          label={labels.code}
          hint={labels.hint}
          error={form.error("code")}
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9 \-]*"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
      )}
    </ActionForm>
  );
}
