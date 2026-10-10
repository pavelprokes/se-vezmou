"use client";

import { CircleCheck, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Radio } from "@/components/ui/choice";
import { Field, Fieldset } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Icon } from "@/components/ui/icon";
import { TextArea } from "@/components/ui/textarea";
import {
  answerField,
  attendanceField,
  fieldId,
  guestField,
  type FieldErrors,
  type FormExtra,
  type RsvpFormModel,
} from "@/lib/rsvp/form";
import { useAdminT, type AdminKey } from "../i18n";

export type EntryState =
  { status: "saved" } | { status: "errors"; errors: FieldErrors } | { status: "failed" } | null;

const ERROR_KEY: Record<string, AdminKey> = {
  required: "admin.guests.entry.error.required",
  name: "admin.guests.entry.error.name",
  age: "admin.guests.entry.error.age",
  email: "admin.guests.entry.error.invalid",
  phone: "admin.guests.entry.error.invalid",
  too_long: "admin.guests.entry.error.too_long",
  choice: "admin.guests.entry.error.choice",
  invalid: "admin.guests.entry.error.invalid",
};

const MAX_EXTRAS = 20;

/**
 * Ruční zápis odpovědi domácnosti (host odpověděl telefonem, FR-ADM-5). Pole mají stejné názvy jako
 * formulář hosta, takže server použije stejné ověření (`parseSubmission`). Povinné vlastní otázky se
 * od správce nevyžadují (telefonát nemusí na všechno odpovědět), účast na pozvaných událostech ano.
 * Doprovod a děti doplňuje jen to, co pár u RSVP povolil.
 */
export function ResponseEntry({
  householdName,
  model,
  action,
  listHref,
}: {
  householdName: string;
  model: RsvpFormModel;
  action: (formData: FormData) => Promise<EntryState>;
  listHref: string;
}) {
  const t = useAdminT();
  const id = useId();
  const [state, setState] = useState<EntryState>(null);
  const [pending, startTransition] = useTransition();
  const [extras, setExtras] = useState<(FormExtra & { key: number })[]>(
    model.values.extras.map((extra, key) => ({ ...extra, key })),
  );
  const nextKey = useRef(model.values.extras.length);
  const errors = state?.status === "errors" ? state.errors : {};
  const summary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state?.status === "errors" || state?.status === "failed") {
      const first = Object.keys(errors)[0];
      const target = first ? document.getElementById(fieldId(first)) : null;
      (target ?? summary.current)?.focus();
    }
    // zaměření jen po novém výsledku odeslání
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Odeslání bez automatického vynulování formuláře: po chybě zůstane vše, co správce zadal (WCAG 3.3.7)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => setState(await action(data)));
  };

  const hasAdult = extras.some((extra) => extra.kind === "adult");
  const addExtra = (kind: "adult" | "child") => {
    const key = nextKey.current++;
    setExtras((current) => [
      ...current,
      { key, kind, name: "", age: "", attendance: {}, diet: "", allergies: "" },
    ]);
  };

  const errorText = (field: string) => {
    const code = errors[field];
    return code ? t(ERROR_KEY[code] ?? "admin.guests.entry.error.invalid") : undefined;
  };

  const attendance = (field: string, current: string | undefined, label: string) => (
    <Fieldset key={field} legend={label} error={errorText(field)}>
      <div className="flex flex-wrap gap-x-6">
        <Radio
          id={fieldId(field)}
          name={field}
          value="yes"
          label={t("admin.guests.entry.yes")}
          defaultChecked={current === "yes"}
        />
        <Radio
          name={field}
          value="no"
          label={t("admin.guests.entry.no")}
          defaultChecked={current === "no"}
        />
      </div>
    </Fieldset>
  );

  const health = (prefix: string, diet: string, allergies: string) =>
    model.flags.diet ? (
      <div className="flex flex-col gap-4">
        <TextArea
          id={fieldId(`${prefix}.diet`)}
          name={`${prefix}.diet`}
          label={t("admin.guests.entry.diet")}
          rows={2}
          maxLength={1000}
          defaultValue={diet}
          error={errorText(`${prefix}.diet`)}
        />
        <TextArea
          id={fieldId(`${prefix}.allergies`)}
          name={`${prefix}.allergies`}
          label={t("admin.guests.entry.allergies")}
          rows={2}
          maxLength={1000}
          defaultValue={allergies}
          error={errorText(`${prefix}.allergies`)}
        />
      </div>
    ) : null;

  const choiceGroup = (
    key: string,
    legend: string,
    options: { value: string; label: string }[],
  ) => {
    const field = answerField(key);
    return (
      <Fieldset key={field} legend={legend} error={errorText(field)}>
        {options.map((option, index) => (
          <Radio
            key={option.value}
            id={index === 0 ? fieldId(field) : undefined}
            name={field}
            value={option.value}
            label={option.label}
            defaultChecked={model.values.answers[key] === option.value}
          />
        ))}
      </Fieldset>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <div ref={summary} tabIndex={-1} />

      {model.guests.map((guest) => {
        const prefix = guestField(guest.id);
        const events = model.events.filter((event) => guest.eventIds.includes(event.id));
        return (
          <Card as="section" key={guest.id} aria-labelledby={`${id}-g-${guest.id}`}>
            <h2 id={`${id}-g-${guest.id}`} className="text-2xl font-medium">
              {guest.name}
            </h2>
            <div className="mt-4 flex flex-col gap-4">
              {events.length === 0 ? (
                <p className="text-muted">{t("admin.guests.entry.noEvents")}</p>
              ) : (
                events.map((event) =>
                  attendance(
                    attendanceField(prefix, event.id),
                    model.values.attendance[attendanceField(prefix, event.id)],
                    t("admin.guests.entry.attends", { event: event.title }),
                  ),
                )
              )}
              {health(
                prefix,
                model.values.diet[prefix] ?? "",
                model.values.allergies[prefix] ?? "",
              )}
            </div>
          </Card>
        );
      })}

      {extras.map((extra, index) => {
        const prefix = `x.${index}`;
        return (
          <Card as="section" key={extra.key} aria-labelledby={`${id}-x-${extra.key}`}>
            <h2 id={`${id}-x-${extra.key}`} className="text-2xl font-medium">
              {extra.kind === "child"
                ? t("admin.guests.entry.extraChild")
                : t("admin.guests.entry.extraAdult")}
            </h2>
            <input type="hidden" name={`${prefix}.kind`} value={extra.kind} />
            <div className="mt-4 flex flex-col gap-4">
              <Field
                id={fieldId(`${prefix}.name`)}
                name={`${prefix}.name`}
                label={t("admin.guests.entry.name")}
                autoComplete="off"
                maxLength={200}
                defaultValue={extra.name}
                error={errorText(`${prefix}.name`)}
              />
              {extra.kind === "child" ? (
                <Field
                  id={fieldId(`${prefix}.age`)}
                  name={`${prefix}.age`}
                  label={t("admin.guests.entry.age")}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={2}
                  className="max-w-40"
                  defaultValue={extra.age}
                  error={errorText(`${prefix}.age`)}
                />
              ) : null}
              {model.events.map((event) =>
                attendance(
                  attendanceField(prefix, event.id),
                  extra.attendance[event.id],
                  t("admin.guests.entry.attends", { event: event.title }),
                ),
              )}
              {health(prefix, extra.diet, extra.allergies)}
            </div>
          </Card>
        );
      })}

      {(model.flags.plusOne && !hasAdult) || model.flags.children ? (
        <div className="flex flex-wrap gap-3">
          {model.flags.plusOne && !hasAdult ? (
            <Button type="button" variant="secondary" onClick={() => addExtra("adult")}>
              <Icon icon={Plus} size={18} />
              {t("admin.guests.entry.addAdult")}
            </Button>
          ) : null}
          {model.flags.children && extras.length < MAX_EXTRAS ? (
            <Button type="button" variant="secondary" onClick={() => addExtra("child")}>
              <Icon icon={Plus} size={18} />
              {t("admin.guests.entry.addChild")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {model.flags.lodging ||
      model.flags.transport ||
      model.flags.song ||
      model.flags.message ||
      model.questions.length > 0 ? (
        <Card as="section" aria-labelledby={`${id}-answers`}>
          <h2 id={`${id}-answers`} className="text-2xl font-medium">
            {t("admin.guests.entry.answers")}
          </h2>
          <div className="mt-4 flex flex-col gap-4">
            {model.flags.lodging
              ? choiceGroup("lodging", t("admin.guests.entry.lodging"), [
                  { value: "need", label: t("admin.guests.entry.lodgingNeed") },
                  { value: "own", label: t("admin.guests.entry.lodgingOwn") },
                  { value: "unsure", label: t("admin.guests.entry.lodgingUnsure") },
                ])
              : null}
            {model.flags.transport
              ? choiceGroup("transport", t("admin.guests.entry.transport"), [
                  { value: "need", label: t("admin.guests.entry.transportNeed") },
                  { value: "own", label: t("admin.guests.entry.transportOwn") },
                  { value: "offer", label: t("admin.guests.entry.transportOffer") },
                ])
              : null}
            {model.flags.song ? (
              <Field
                id={fieldId(answerField("song"))}
                name={answerField("song")}
                label={t("admin.guests.entry.song")}
                maxLength={200}
                defaultValue={model.values.answers.song ?? ""}
                error={errorText(answerField("song"))}
              />
            ) : null}
            {model.flags.message ? (
              <TextArea
                id={fieldId(answerField("message"))}
                name={answerField("message")}
                label={t("admin.guests.entry.message")}
                rows={4}
                maxLength={1000}
                defaultValue={model.values.answers.message ?? ""}
                error={errorText(answerField("message"))}
              />
            ) : null}
            {model.questions.map((question) => {
              const field = answerField(question.key);
              const current = model.values.answers[question.key] ?? "";
              if (question.type === "text") {
                return (
                  <Field
                    key={question.key}
                    id={fieldId(field)}
                    name={field}
                    label={question.label}
                    maxLength={1000}
                    defaultValue={current}
                    error={errorText(field)}
                  />
                );
              }
              const options =
                question.type === "bool"
                  ? [
                      { value: "yes", label: t("admin.guests.entry.yes") },
                      { value: "no", label: t("admin.guests.entry.no") },
                    ]
                  : question.options;
              return choiceGroup(question.key, question.label, options);
            })}
          </div>
        </Card>
      ) : null}

      <FormAlert>
        {state?.status === "errors"
          ? t("admin.guests.entry.error.fix")
          : state?.status === "failed"
            ? t("admin.guests.entry.error.generic")
            : null}
      </FormAlert>
      <div role="status" aria-live="polite" className="min-h-6">
        {state?.status === "saved" ? (
          <p className="text-ink flex items-center gap-2 font-medium" data-testid="entry-saved">
            <Icon icon={CircleCheck} />
            {t("admin.guests.entry.saved")}
          </p>
        ) : null}
      </div>
      <p className="text-muted">{t("admin.guests.entry.note", { name: householdName })}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t("admin.common.saving") : t("admin.guests.entry.save")}
        </Button>
        <a href={listHref} className={buttonVariants({ variant: "text" })}>
          {t("admin.guests.entry.back")}
        </a>
      </div>
    </form>
  );
}
