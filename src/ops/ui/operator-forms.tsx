"use client";

import { Field } from "@/components/ui/field";
import { TextArea } from "@/components/ui/textarea";
import {
  createOperatorAction,
  resetOperatorMfaAction,
  setOperatorDisabledAction,
} from "../actions/operators";
import { ActionForm } from "./action-form";
import { SelectField, type SelectOption } from "./select-field";

/** Formuláře správy operátorů (jen majitel). Texty a chyby přicházejí ze serveru hotové. */

type Errors = Record<string, string>;

export function CreateOperatorForm({
  errors,
  roles,
  labels,
}: {
  errors: Errors;
  roles: SelectOption[];
  labels: { email: string; role: string; submit: string; success: string };
}) {
  return (
    <ActionForm
      action={createOperatorAction}
      submitLabel={labels.submit}
      successText={labels.success}
      errors={errors}
    >
      {(form) => (
        <>
          <Field
            id={form.id("email")}
            name="email"
            type="email"
            label={labels.email}
            error={form.error("email")}
            defaultValue={form.value("email")}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
          <SelectField
            id={form.id("role")}
            name="role"
            label={labels.role}
            options={roles}
            error={form.error("role")}
            defaultValue={form.value("role")}
          />
        </>
      )}
    </ActionForm>
  );
}

export function DisableOperatorForm({
  errors,
  targets,
  labels,
}: {
  errors: Errors;
  targets: SelectOption[];
  labels: {
    target: string;
    action: string;
    disable: string;
    enable: string;
    reason: string;
    reasonHint: string;
    submit: string;
    successDisable: string;
    successEnable: string;
  };
}) {
  return (
    <ActionForm
      action={setOperatorDisabledAction}
      submitLabel={labels.submit}
      errors={errors}
      below={(state) =>
        state?.ok ? (
          <p role="status" className="text-pine mt-3 font-medium">
            {state.values?.mode === "enable" ? labels.successEnable : labels.successDisable}
          </p>
        ) : null
      }
    >
      {(form) => (
        <>
          <SelectField
            id={form.id("targetId")}
            name="targetId"
            label={labels.target}
            options={targets}
            error={form.error("targetId")}
            defaultValue={form.value("targetId")}
          />
          <SelectField
            id={form.id("mode")}
            name="mode"
            label={labels.action}
            options={[
              { value: "disable", label: labels.disable },
              { value: "enable", label: labels.enable },
            ]}
            error={form.error("mode")}
            defaultValue={form.value("mode")}
          />
          <TextArea
            id={form.id("reason")}
            name="reason"
            label={labels.reason}
            hint={labels.reasonHint}
            error={form.error("reason")}
            defaultValue={form.value("reason")}
            required
          />
        </>
      )}
    </ActionForm>
  );
}

export function ResetMfaForm({
  errors,
  targets,
  labels,
}: {
  errors: Errors;
  targets: SelectOption[];
  labels: {
    target: string;
    reason: string;
    reasonHint: string;
    submit: string;
    success: string;
  };
}) {
  return (
    <ActionForm
      action={resetOperatorMfaAction}
      submitLabel={labels.submit}
      successText={labels.success}
      errors={errors}
    >
      {(form) => (
        <>
          <SelectField
            id={form.id("targetId")}
            name="targetId"
            label={labels.target}
            options={targets}
            error={form.error("targetId")}
            defaultValue={form.value("targetId")}
          />
          <TextArea
            id={form.id("reason")}
            name="reason"
            label={labels.reason}
            hint={labels.reasonHint}
            error={form.error("reason")}
            defaultValue={form.value("reason")}
            required
          />
        </>
      )}
    </ActionForm>
  );
}
