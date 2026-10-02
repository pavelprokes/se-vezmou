"use client";

import { Field } from "@/components/ui/field";
import { TextArea } from "@/components/ui/textarea";
import type { GuestDataRow } from "@/lib/db/rpc-ops";
import {
  addNoteAction,
  changeSlugAction,
  changeStatusAction,
  extendRetentionAction,
  restoreWeddingAction,
  sendLoginLinkAction,
  viewGuestDataAction,
  type GuestDataResult,
} from "../actions/wedding";
import { ActionForm } from "./action-form";
import { SelectField, type SelectOption } from "./select-field";

/**
 * Formuláře zásahů do zakázky. Texty a chybová hlášení přicházejí ze serveru hotové. Každý zásah je
 * Server Action (původ, relace AAL2, role, zod, `op_*` s auditem); výsledek se oznámí v živé oblasti.
 */

type Errors = Record<string, string>;

type Base = { weddingId: string; errors: Errors };

export function StatusForm({
  weddingId,
  errors,
  options,
  labels,
}: Base & {
  options: SelectOption[];
  labels: { status: string; reason: string; reasonHint: string; submit: string };
}) {
  return (
    <ActionForm
      action={changeStatusAction}
      hiddenFields={{ weddingId }}
      submitLabel={labels.submit}
      errors={errors}
    >
      {(form) => (
        <>
          <SelectField
            id={form.id("status")}
            name="status"
            label={labels.status}
            options={options}
            error={form.error("status")}
            defaultValue={form.value("status")}
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

export function SlugForm({
  weddingId,
  errors,
  labels,
}: Base & {
  labels: {
    slug: string;
    slugHint: string;
    reason: string;
    reasonHint: string;
    submit: string;
  };
}) {
  return (
    <ActionForm
      action={changeSlugAction}
      hiddenFields={{ weddingId }}
      submitLabel={labels.submit}
      errors={errors}
    >
      {(form) => (
        <>
          <Field
            id={form.id("slug")}
            name="slug"
            type="text"
            label={labels.slug}
            hint={labels.slugHint}
            error={form.error("slug")}
            defaultValue={form.value("slug")}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            required
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

export function ExtendForm({
  weddingId,
  errors,
  kinds,
  labels,
}: Base & {
  kinds: SelectOption[];
  labels: {
    kind: string;
    until: string;
    untilHint: string;
    reason: string;
    reasonHint: string;
    submit: string;
  };
}) {
  return (
    <ActionForm
      action={extendRetentionAction}
      hiddenFields={{ weddingId }}
      submitLabel={labels.submit}
      errors={errors}
    >
      {(form) => (
        <>
          <SelectField
            id={form.id("kind")}
            name="kind"
            label={labels.kind}
            options={kinds}
            error={form.error("kind")}
            defaultValue={form.value("kind")}
          />
          <Field
            id={form.id("until")}
            name="until"
            type="date"
            label={labels.until}
            hint={labels.untilHint}
            error={form.error("until")}
            defaultValue={form.value("until")}
            required
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

export function RestoreForm({
  weddingId,
  errors,
  labels,
}: Base & {
  labels: { reason: string; reasonHint: string; submit: string };
}) {
  return (
    <ActionForm
      action={restoreWeddingAction}
      hiddenFields={{ weddingId }}
      submitLabel={labels.submit}
      errors={errors}
    >
      {(form) => (
        <TextArea
          id={form.id("reason")}
          name="reason"
          label={labels.reason}
          hint={labels.reasonHint}
          error={form.error("reason")}
          defaultValue={form.value("reason")}
          required
        />
      )}
    </ActionForm>
  );
}

export function LoginLinkForm({
  weddingId,
  errors,
  admins,
  labels,
}: Base & {
  admins: SelectOption[];
  labels: { admin: string; hint: string; submit: string };
}) {
  return (
    <ActionForm
      action={sendLoginLinkAction}
      hiddenFields={{ weddingId }}
      submitLabel={labels.submit}
      errors={errors}
    >
      {(form) => (
        <SelectField
          id={form.id("adminId")}
          name="adminId"
          label={labels.admin}
          hint={labels.hint}
          options={admins}
          error={form.error("adminId")}
        />
      )}
    </ActionForm>
  );
}

export function NoteForm({
  weddingId,
  errors,
  labels,
}: Base & { labels: { note: string; hint: string; submit: string } }) {
  return (
    <ActionForm
      action={addNoteAction}
      hiddenFields={{ weddingId }}
      submitLabel={labels.submit}
      errors={errors}
    >
      {(form) => (
        <TextArea
          id={form.id("body")}
          name="body"
          label={labels.note}
          hint={labels.hint}
          error={form.error("body")}
          defaultValue={form.value("body")}
          rows={4}
          required
        />
      )}
    </ActionForm>
  );
}

export type GuestLabels = {
  reason: string;
  reasonHint: string;
  submit: string;
  denied: string;
  empty: string;
  caption: string;
  household: string;
  name: string;
  kind: string;
  diet: string;
  allergies: string;
  adult: string;
  child: string;
  childNoAge: string;
  plusOne: string;
};

function kindOf(row: GuestDataRow, labels: GuestLabels): string {
  if (row.isPlusOne) return labels.plusOne;
  if (row.isChild) {
    return row.age === null ? labels.childNoAge : labels.child.replace("{age}", String(row.age));
  }
  return labels.adult;
}

/**
 * Nahlédnutí do údajů hostů. Výchozí stav je bez přístupu; výsledek (tabulka, nebo hlášení o odmítnutí) je jen
 * v odpovědi této akce a nikde se neukládá. Důvod je povinný.
 */
export function GuestDataForm({ weddingId, errors, labels }: Base & { labels: GuestLabels }) {
  return (
    <ActionForm<GuestDataResult>
      action={viewGuestDataAction}
      hiddenFields={{ weddingId }}
      submitLabel={labels.submit}
      errors={errors}
      below={(state) => {
        if (!state?.ok || !state.data) return null;
        const { outcome, rows } = state.data;
        if (outcome === "denied") {
          return (
            <p role="status" className="text-cinnamon-deep mt-4 font-medium">
              {labels.denied}
            </p>
          );
        }
        if (outcome === "empty") {
          return (
            <p role="status" className="mt-4 font-medium">
              {labels.empty}
            </p>
          );
        }
        return (
          <div
            role="region"
            aria-label={labels.caption}
            tabIndex={0}
            className="border-hairline rounded-button mt-4 overflow-x-auto border"
          >
            <table className="w-full min-w-[36rem] border-collapse text-left">
              <caption className="sr-only">{labels.caption}</caption>
              <thead>
                <tr>
                  {[labels.household, labels.name, labels.kind, labels.diet, labels.allergies].map(
                    (heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className="bg-linen text-ink border-hairline border-b px-3 py-2 text-sm font-medium"
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.guestId}>
                    <td className="border-hairline border-b px-3 py-2">{row.householdLabel}</td>
                    <th scope="row" className="border-hairline border-b px-3 py-2 font-medium">
                      {row.displayName}
                    </th>
                    <td className="border-hairline border-b px-3 py-2">{kindOf(row, labels)}</td>
                    <td className="border-hairline border-b px-3 py-2">{row.diet ?? ""}</td>
                    <td className="border-hairline border-b px-3 py-2">{row.allergies ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }}
    >
      {(form) => (
        <TextArea
          id={form.id("reason")}
          name="reason"
          label={labels.reason}
          hint={labels.reasonHint}
          error={form.error("reason")}
          defaultValue={form.value("reason")}
          required
        />
      )}
    </ActionForm>
  );
}
