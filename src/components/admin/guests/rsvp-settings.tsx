"use client";

import { CircleCheck, CircleHelp, CircleX } from "lucide-react";
import { useId, useRef, useState } from "react";
import { isoParts, joinParts } from "@/admin/site/time";
import type { SaveSettingsAction } from "@/admin/guests/action-types";
import {
  BUILTIN_QUESTIONS,
  QUESTION_LIMITS,
  rsvpWindow,
  type BuiltinQuestion,
  type QuestionInput,
  type RsvpSettingsInput,
} from "@/admin/guests/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/choice";
import { Field, Fieldset } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/i18n/config";
import type { I18nText } from "@/site/i18n-text";
import { AddButton, ItemCard, LocalizedField, Note, SelectField } from "../fields";
import { useAdminT, type AdminKey } from "../i18n";
import { StatusMessage } from "./status";

export interface SettingsEvent {
  id: string;
  title: string;
}

type OptionRow = { key: number; value: string; label: I18nText | null };
type QuestionRow = {
  key: number;
  id: string | null;
  questionKey: string;
  type: "text" | "choice" | "bool";
  label: I18nText | null;
  options: OptionRow[];
  required: boolean;
  eventId: string;
  enabled: boolean;
};

export interface SettingsInitial {
  opensAt: string | null;
  closesAt: string | null;
  allowUnlisted: boolean;
  emailConfirmation: boolean;
  notifyCouple: boolean;
  enabledQuestions: Partial<Record<BuiltinQuestion, boolean>>;
  questions: {
    id: string;
    key: string;
    type: "text" | "choice" | "bool";
    label: I18nText | null;
    options: { value: string; label: I18nText | null }[];
    required: boolean;
    eventId: string | null;
    enabled: boolean;
  }[];
}

const BUILTIN_KEYS: Record<BuiltinQuestion, { label: AdminKey; hint: AdminKey }> = {
  plus_one: {
    label: "admin.guests.rsvp.q.plus_one",
    hint: "admin.guests.rsvp.q.plus_one.hint",
  },
  children: {
    label: "admin.guests.rsvp.q.children",
    hint: "admin.guests.rsvp.q.children.hint",
  },
  diet: { label: "admin.guests.rsvp.q.diet", hint: "admin.guests.rsvp.q.diet.hint" },
  lodging: { label: "admin.guests.rsvp.q.lodging", hint: "admin.guests.rsvp.q.lodging.hint" },
  transport: {
    label: "admin.guests.rsvp.q.transport",
    hint: "admin.guests.rsvp.q.transport.hint",
  },
  song: { label: "admin.guests.rsvp.q.song", hint: "admin.guests.rsvp.q.song.hint" },
};

function randomKey(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `${prefix}${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("")}`.slice(
    0,
    20,
  );
}

/**
 * Nastavení RSVP (FR-RSVP-4, FR-RSVP-5): otevření a uzavření podle data i hned, host mimo seznam,
 * potvrzení e-mailem, vestavěné otázky a vlastní otázky (text, výběr, ano/ne; volitelně jen pro
 * hosty, kteří přijdou na událost). Ukládá se tlačítkem; chyby jsou u polí slovy a ikonou.
 */
export function RsvpSettings({
  initial,
  timeZone,
  locales,
  events,
  save,
}: {
  initial: SettingsInitial;
  timeZone: string;
  locales: readonly Locale[];
  events: SettingsEvent[];
  save: SaveSettingsAction;
}) {
  const t = useAdminT();
  const id = useId();
  const [now] = useState(() => new Date());
  const parts = (iso: string | null) => (iso ? isoParts(iso, timeZone) : { date: "", time: "" });
  const [open, setOpen] = useState(parts(initial.opensAt));
  const [close, setClose] = useState(parts(initial.closesAt));
  const [allowUnlisted, setAllowUnlisted] = useState(initial.allowUnlisted);
  const [emailConfirmation, setEmailConfirmation] = useState(initial.emailConfirmation);
  const [notifyCouple, setNotifyCouple] = useState(initial.notifyCouple);
  const [flags, setFlags] = useState(initial.enabledQuestions);
  const nextKey = useRef(1000);
  const [questions, setQuestions] = useState<QuestionRow[]>(
    initial.questions.map((q, key) => ({
      key,
      id: q.id,
      questionKey: q.key,
      type: q.type,
      label: q.label,
      options: q.options.map((o, i) => ({ key: i, value: o.value, label: o.label })),
      required: q.required,
      eventId: q.eventId ?? "",
      enabled: q.enabled,
    })),
  );
  const [errors, setErrors] = useState<Record<string, AdminKey>>({});
  const [formError, setFormError] = useState<AdminKey | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  const opensIso = open.date && open.time ? joinParts(open.date, open.time, timeZone) : null;
  const closesIso = close.date && close.time ? joinParts(close.date, close.time, timeZone) : null;
  const windowNow = rsvpWindow(opensIso, closesIso, now);
  const WINDOW = {
    open: { icon: CircleCheck, key: "admin.guests.rsvp.window.open" },
    scheduled: { icon: CircleHelp, key: "admin.guests.rsvp.window.scheduled" },
    closed: { icon: CircleX, key: "admin.guests.rsvp.window.closed" },
  } as const;

  const nowParts = isoParts(now.toISOString(), timeZone);
  const openNow = () => {
    setOpen({ date: "", time: "" });
    if (closesIso && Date.parse(closesIso) <= now.getTime()) setClose({ date: "", time: "" });
  };
  const closeNow = () => {
    if (opensIso && Date.parse(opensIso) > now.getTime()) setOpen({ date: "", time: "" });
    setClose(nowParts);
  };

  const patchQuestion = (key: number, change: Partial<QuestionRow>) =>
    setQuestions((current) => current.map((q) => (q.key === key ? { ...q, ...change } : q)));

  const addQuestion = () => {
    const key = nextKey.current++;
    setQuestions((current) => [
      ...current,
      {
        key,
        id: null,
        questionKey: randomKey("q"),
        type: "text",
        label: null,
        options: [],
        required: false,
        eventId: "",
        enabled: true,
      },
    ]);
    setTimeout(
      () =>
        (
          document.getElementById(`${id}-q-${key}`)?.querySelector("textarea,input") as
            HTMLElement | null | undefined
        )?.focus(),
      0,
    );
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: Record<string, AdminKey> = {};
    setFormError(null);

    if ((open.date === "") !== (open.time === "")) found.opens = "admin.guests.rsvp.error.pair";
    if ((close.date === "") !== (close.time === "")) found.closes = "admin.guests.rsvp.error.pair";
    if (open.date && open.time && !opensIso) found.opens = "admin.guests.rsvp.error.date";
    if (close.date && close.time && !closesIso) found.closes = "admin.guests.rsvp.error.date";
    if (opensIso && closesIso && Date.parse(closesIso) <= Date.parse(opensIso)) {
      found.closes = "admin.guests.rsvp.error.period";
    }
    const filled = (text: I18nText | null) => locales.some((l) => (text?.[l] ?? "").trim() !== "");
    for (const q of questions) {
      if (!filled(q.label)) found[`q${q.key}`] = "admin.guests.rsvp.error.label";
      else if (q.type === "choice") {
        if (q.options.length < 2) found[`q${q.key}`] = "admin.guests.rsvp.error.options";
        else if (q.options.some((o) => !filled(o.label))) {
          found[`q${q.key}`] = "admin.guests.rsvp.error.optionLabel";
        }
      }
    }
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFormError("admin.guests.rsvp.error.fix");
      return;
    }

    const clean = (text: I18nText | null): I18nText => {
      const out: I18nText = {};
      for (const l of locales) {
        const value = (text?.[l] ?? "").trim();
        if (value) out[l] = value;
      }
      return out;
    };
    const input: RsvpSettingsInput = {
      opensAt: opensIso,
      closesAt: closesIso,
      allowUnlisted,
      emailConfirmation,
      notifyCouple,
      enabledQuestions: Object.fromEntries(
        BUILTIN_QUESTIONS.map((key) => [key, flags[key] === true]),
      ),
      questions: questions.map((q): QuestionInput => ({
        id: q.id,
        key: q.questionKey,
        type: q.type,
        label: clean(q.label),
        options:
          q.type === "choice"
            ? q.options.map((o) => ({ value: o.value, label: clean(o.label) }))
            : null,
        required: q.required,
        eventId: q.eventId === "" ? null : q.eventId,
        enabled: q.enabled,
      })),
    };

    setState("busy");
    const result = await save(input);
    if (result.status === "saved") {
      // nové otázky dostaly při uložení identifikátor; další uložení je upraví, nezaloží znovu
      setQuestions((current) =>
        current.map((q) => ({
          ...q,
          id: q.id ?? result.questions.find((saved) => saved.key === q.questionKey)?.id ?? null,
        })),
      );
      setState("done");
      return;
    }
    setState("idle");
    setFormError(
      result.status === "invalid"
        ? result.reason === "period"
          ? "admin.guests.rsvp.error.period"
          : "admin.guests.rsvp.error.invalid"
        : result.status === "limited"
          ? "admin.guests.error.limited"
          : result.status === "unauthorized"
            ? "admin.guests.error.unauthorized"
            : "admin.guests.error.generic",
    );
  };

  const eventOptions = events.map((event) => (
    <option key={event.id} value={event.id}>
      {event.title}
    </option>
  ));

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <Card as="section" aria-labelledby={`${id}-window`}>
        <h2 id={`${id}-window`} className="text-2xl font-medium">
          {t("admin.guests.rsvp.window.title")}
        </h2>
        <p className="mt-3 flex items-center gap-2 text-lg font-medium" data-testid="rsvp-window">
          <Icon icon={WINDOW[windowNow].icon} />
          {t(WINDOW[windowNow].key)}
        </p>
        <p className="text-muted mt-2 max-w-prose">
          {t("admin.guests.rsvp.window.intro", { zone: timeZone })}
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Fieldset
            legend={t("admin.guests.rsvp.opens")}
            error={errors.opens ? t(errors.opens) : undefined}
          >
            <div className="flex flex-wrap gap-3">
              <Field
                label={t("admin.guests.rsvp.date")}
                type="date"
                value={open.date}
                onChange={(e) => setOpen({ ...open, date: e.target.value })}
              />
              <Field
                label={t("admin.guests.rsvp.time")}
                type="time"
                value={open.time}
                onChange={(e) => setOpen({ ...open, time: e.target.value })}
              />
            </div>
          </Fieldset>
          <Fieldset
            legend={t("admin.guests.rsvp.closes")}
            error={errors.closes ? t(errors.closes) : undefined}
          >
            <div className="flex flex-wrap gap-3">
              <Field
                label={t("admin.guests.rsvp.date")}
                type="date"
                value={close.date}
                onChange={(e) => setClose({ ...close, date: e.target.value })}
              />
              <Field
                label={t("admin.guests.rsvp.time")}
                type="time"
                value={close.time}
                onChange={(e) => setClose({ ...close, time: e.target.value })}
              />
            </div>
          </Fieldset>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button type="button" variant="secondary" onClick={openNow}>
            {t("admin.guests.rsvp.openNow")}
          </Button>
          <Button type="button" variant="secondary" onClick={closeNow}>
            {t("admin.guests.rsvp.closeNow")}
          </Button>
        </div>
        <p className="text-muted mt-2 text-sm">{t("admin.guests.rsvp.nowHint")}</p>
      </Card>

      <Card as="section" aria-labelledby={`${id}-who`}>
        <h2 id={`${id}-who`} className="text-2xl font-medium">
          {t("admin.guests.rsvp.who.title")}
        </h2>
        <div className="mt-3 flex flex-col">
          <Checkbox
            label={t("admin.guests.rsvp.unlisted")}
            checked={allowUnlisted}
            onChange={(e) => setAllowUnlisted(e.target.checked)}
          />
          <p className="text-muted ml-9 text-sm">{t("admin.guests.rsvp.unlisted.hint")}</p>
          <Checkbox
            label={t("admin.guests.rsvp.email")}
            checked={emailConfirmation}
            onChange={(e) => setEmailConfirmation(e.target.checked)}
          />
          <p className="text-muted ml-9 text-sm">{t("admin.guests.rsvp.email.hint")}</p>
          <Checkbox
            label={t("admin.guests.rsvp.notify")}
            checked={notifyCouple}
            onChange={(e) => setNotifyCouple(e.target.checked)}
          />
          <p className="text-muted ml-9 text-sm">{t("admin.guests.rsvp.notify.hint")}</p>
        </div>
      </Card>

      <Card as="section" aria-labelledby={`${id}-builtin`}>
        <h2 id={`${id}-builtin`} className="text-2xl font-medium">
          {t("admin.guests.rsvp.builtin.title")}
        </h2>
        <p className="text-muted mt-2">{t("admin.guests.rsvp.builtin.intro")}</p>
        <div className="mt-3 flex flex-col">
          {BUILTIN_QUESTIONS.map((key) => (
            <div key={key}>
              <Checkbox
                label={t(BUILTIN_KEYS[key].label)}
                checked={flags[key] === true}
                onChange={(e) => setFlags({ ...flags, [key]: e.target.checked })}
              />
              <p className="text-muted ml-9 text-sm">{t(BUILTIN_KEYS[key].hint)}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card as="section" aria-labelledby={`${id}-custom`}>
        <h2 id={`${id}-custom`} className="text-2xl font-medium">
          {t("admin.guests.rsvp.custom.title")}
        </h2>
        <p className="text-muted mt-2">{t("admin.guests.rsvp.custom.intro")}</p>
        <div className="mt-4 flex flex-col gap-4">
          {questions.map((q, index) => (
            <div key={q.key} id={`${id}-q-${q.key}`}>
              <ItemCard
                title={t("admin.guests.rsvp.custom.n", { n: index + 1 })}
                removeLabel={t("admin.guests.rsvp.custom.remove", { n: index + 1 })}
                onRemove={() => setQuestions((current) => current.filter((x) => x.key !== q.key))}
              >
                <LocalizedField
                  label={t("admin.guests.rsvp.custom.label")}
                  value={q.label}
                  locales={locales}
                  maxLength={QUESTION_LIMITS.label}
                  onChange={(label) => patchQuestion(q.key, { label })}
                />
                <SelectField
                  label={t("admin.guests.rsvp.custom.type")}
                  value={q.type}
                  onChange={(type) =>
                    patchQuestion(q.key, {
                      type: type as QuestionRow["type"],
                      options:
                        type === "choice" && q.options.length === 0
                          ? [
                              { key: 0, value: randomKey("v"), label: null },
                              { key: 1, value: randomKey("v"), label: null },
                            ]
                          : q.options,
                    })
                  }
                >
                  <option value="text">{t("admin.guests.rsvp.custom.type.text")}</option>
                  <option value="choice">{t("admin.guests.rsvp.custom.type.choice")}</option>
                  <option value="bool">{t("admin.guests.rsvp.custom.type.bool")}</option>
                </SelectField>
                {q.type === "choice" ? (
                  <div className="flex flex-col gap-3">
                    {q.options.map((option, optionIndex) => (
                      <div key={option.key} className="flex flex-col gap-2">
                        <LocalizedField
                          label={t("admin.guests.rsvp.custom.option", { n: optionIndex + 1 })}
                          value={option.label}
                          locales={locales}
                          maxLength={QUESTION_LIMITS.optionLabel}
                          onChange={(label) =>
                            patchQuestion(q.key, {
                              options: q.options.map((o) =>
                                o.key === option.key ? { ...o, label } : o,
                              ),
                            })
                          }
                        />
                        {q.options.length > 2 ? (
                          <div>
                            <Button
                              type="button"
                              variant="text"
                              onClick={() =>
                                patchQuestion(q.key, {
                                  options: q.options.filter((o) => o.key !== option.key),
                                })
                              }
                            >
                              {t("admin.guests.rsvp.custom.removeOption", { n: optionIndex + 1 })}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                    <div>
                      <AddButton
                        disabled={q.options.length >= QUESTION_LIMITS.options}
                        onClick={() =>
                          patchQuestion(q.key, {
                            options: [
                              ...q.options,
                              { key: nextKey.current++, value: randomKey("v"), label: null },
                            ],
                          })
                        }
                      >
                        {t("admin.guests.rsvp.custom.addOption")}
                      </AddButton>
                    </div>
                  </div>
                ) : null}
                <SelectField
                  label={t("admin.guests.rsvp.custom.event")}
                  hint={t("admin.guests.rsvp.custom.eventHint")}
                  value={q.eventId}
                  onChange={(eventId) => patchQuestion(q.key, { eventId })}
                >
                  <option value="">{t("admin.guests.rsvp.custom.eventAll")}</option>
                  {eventOptions}
                </SelectField>
                <Checkbox
                  label={t("admin.guests.rsvp.custom.required")}
                  checked={q.required}
                  onChange={(e) => patchQuestion(q.key, { required: e.target.checked })}
                />
                <Checkbox
                  label={t("admin.guests.rsvp.custom.enabled")}
                  checked={q.enabled}
                  onChange={(e) => patchQuestion(q.key, { enabled: e.target.checked })}
                />
                {errors[`q${q.key}`] ? <Note>{t(errors[`q${q.key}`])}</Note> : null}
              </ItemCard>
            </div>
          ))}
          <div>
            <AddButton disabled={questions.length >= QUESTION_LIMITS.custom} onClick={addQuestion}>
              {t("admin.guests.rsvp.custom.add")}
            </AddButton>
          </div>
          <p className="text-muted text-sm">{t("admin.guests.rsvp.custom.removeNote")}</p>
        </div>
      </Card>

      <FormAlert>{formError ? t(formError) : null}</FormAlert>
      <StatusMessage state={state}>
        {state === "busy" ? t("admin.common.saving") : t("admin.guests.rsvp.saved")}
      </StatusMessage>
      <div>
        <Button type="submit" disabled={state === "busy"}>
          {t("admin.guests.rsvp.save")}
        </Button>
      </div>
    </form>
  );
}
