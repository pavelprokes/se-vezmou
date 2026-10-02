"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { DeleteHouseholdAction, SaveHouseholdAction } from "@/admin/guests/action-types";
import { GUEST_LIMITS } from "@/admin/guests/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/choice";
import { Field, Fieldset } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Icon } from "@/components/ui/icon";
import { TextArea } from "@/components/ui/textarea";
import { ConfirmButton } from "../confirm-button";
import { useAdminT, type AdminKey } from "../i18n";
import { go } from "./navigate";
import { StatusMessage } from "./status";

export interface EditorGuest {
  id: string | null;
  name: string;
  isChild: boolean;
  /** Věk jako text z pole (prázdné = nevyplněno). */
  age: string;
  eventIds: string[];
}

export interface EventOption {
  id: string;
  title: string;
}

type Row = EditorGuest & { key: number };

type Problem = { name?: boolean; age?: boolean };

/**
 * Úprava domácnosti: štítek, poznámka, hosté (jméno, dítě s věkem) a pozvání na události u každého
 * hosta (FR-ADM-4). Chyby jsou u polí slovy a ikonou, první chybné pole dostane zaměření;
 * po uložení se vrací na seznam. Smazání domácnosti potvrzuje druhý krok.
 */
export function HouseholdEditor({
  householdId,
  initial,
  events,
  answered,
  listHref,
  eventsHref,
  actions,
}: {
  householdId: string | null;
  initial: { label: string; note: string; guests: EditorGuest[] };
  events: EventOption[];
  /** Domácnost už odpověděla: odebrání hosta smaže i jeho odpověď. */
  answered: boolean;
  listHref: string;
  eventsHref: string;
  actions: { save: SaveHouseholdAction; remove: DeleteHouseholdAction };
}) {
  const t = useAdminT();
  const idPrefix = useId();
  const [label, setLabel] = useState(initial.label);
  const [note, setNote] = useState(initial.note);
  const nextKey = useRef(initial.guests.length);
  const [rows, setRows] = useState<Row[]>(initial.guests.map((guest, key) => ({ ...guest, key })));
  const [problems, setProblems] = useState<Record<number, Problem>>({});
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<AdminKey | null>(null);
  const focusAdded = useRef(false);

  useEffect(() => {
    if (focusAdded.current) {
      focusAdded.current = false;
      document.getElementById(`${idPrefix}-name-${nextKey.current - 1}`)?.focus();
    }
  }, [rows.length, idPrefix]);

  const patch = (key: number, change: Partial<EditorGuest>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));

  const addGuest = () => {
    focusAdded.current = true;
    const key = nextKey.current++;
    setRows((current) => [
      ...current,
      {
        key,
        id: null,
        name: "",
        isChild: false,
        age: "",
        // nový host se zdědí pozvání prvního hosta (domácnost bývá zvaná společně)
        eventIds: current[0]?.eventIds ?? events.map((event) => event.id),
      },
    ]);
  };

  const removeGuest = (key: number) => {
    setRows((current) => current.filter((row) => row.key !== key));
    document.getElementById(`${idPrefix}-add`)?.focus();
  };

  const toggleEvent = (key: number, eventId: string, on: boolean) =>
    setRows((current) =>
      current.map((row) =>
        row.key === key
          ? {
              ...row,
              eventIds: on
                ? [...row.eventIds, eventId]
                : row.eventIds.filter((id) => id !== eventId),
            }
          : row,
      ),
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const found: Record<number, Problem> = {};
    for (const row of rows) {
      const problem: Problem = {};
      if (row.name.trim() === "") problem.name = true;
      if (row.isChild && row.age.trim() !== "") {
        const age = Number(row.age);
        if (!/^\d{1,2}$/.test(row.age.trim()) || age > GUEST_LIMITS.maxChildAge) problem.age = true;
      }
      if (problem.name || problem.age) found[row.key] = problem;
    }
    setProblems(found);
    const first = rows.find((row) => found[row.key]);
    if (first) {
      const field = found[first.key].name ? "name" : "age";
      document.getElementById(`${idPrefix}-${field}-${first.key}`)?.focus();
      setError("admin.guests.editor.error.fix");
      return;
    }
    if (rows.length === 0) {
      setError("admin.guests.editor.error.noGuest");
      return;
    }

    setState("busy");
    const result = await actions.save(householdId, {
      label: label.trim(),
      note: note.trim() === "" ? null : note.trim(),
      guests: rows.map((row) => ({
        id: row.id,
        displayName: row.name.trim(),
        isChild: row.isChild,
        age: row.isChild && row.age.trim() !== "" ? Number(row.age.trim()) : null,
        invitedEventIds: row.eventIds,
      })),
    });
    if (result.status === "saved") {
      setState("done");
      go(`${listHref}${listHref.includes("?") ? "&" : "?"}ulozeno=1`);
      return;
    }
    setState("idle");
    setError(
      result.status === "guest_limit"
        ? "admin.guests.editor.error.limit"
        : result.status === "limited"
          ? "admin.guests.error.limited"
          : result.status === "unauthorized"
            ? "admin.guests.error.unauthorized"
            : result.status === "not_found"
              ? "admin.guests.editor.error.notFound"
              : "admin.guests.editor.error.generic",
    );
  };

  const remove = async () => {
    if (!householdId) return;
    setError(null);
    setState("busy");
    const result = await actions.remove(householdId);
    if (result.status === "deleted" || result.status === "not_found") {
      go(`${listHref}${listHref.includes("?") ? "&" : "?"}smazano=1`);
      return;
    }
    setState("idle");
    setError(
      result.status === "limited"
        ? "admin.guests.error.limited"
        : "admin.guests.editor.error.generic",
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <Card as="section" aria-labelledby={`${idPrefix}-household`}>
        <h2 id={`${idPrefix}-household`} className="text-2xl font-medium">
          {t("admin.guests.editor.household")}
        </h2>
        <div className="mt-4 flex flex-col gap-4">
          <Field
            label={t("admin.guests.editor.label")}
            hint={t("admin.guests.editor.labelHint")}
            value={label}
            maxLength={GUEST_LIMITS.label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <TextArea
            label={t("admin.guests.editor.note")}
            hint={t("admin.guests.editor.noteHint")}
            value={note}
            rows={2}
            maxLength={GUEST_LIMITS.note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      </Card>

      <ol className="flex flex-col gap-4" aria-label={t("admin.guests.editor.guests")}>
        {rows.map((row, index) => (
          <li key={row.key}>
            <Card as="article" aria-labelledby={`${idPrefix}-guest-${row.key}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 id={`${idPrefix}-guest-${row.key}`} className="text-xl font-medium">
                  {t("admin.guests.editor.guestN", { n: index + 1 })}
                </h3>
                {rows.length > 1 ? (
                  <Button
                    type="button"
                    variant="text"
                    onClick={() => removeGuest(row.key)}
                    aria-label={t("admin.guests.editor.removeGuest", {
                      name: row.name.trim() || String(index + 1),
                    })}
                  >
                    <Icon icon={Trash2} size={18} />
                    {t("admin.guests.editor.remove")}
                  </Button>
                ) : null}
              </div>
              <div className="mt-4 flex flex-col gap-4">
                <Field
                  id={`${idPrefix}-name-${row.key}`}
                  label={t("admin.guests.editor.name")}
                  autoComplete="off"
                  value={row.name}
                  maxLength={GUEST_LIMITS.name}
                  error={problems[row.key]?.name ? t("admin.guests.editor.error.name") : undefined}
                  onChange={(event) => patch(row.key, { name: event.target.value })}
                />
                <Checkbox
                  label={t("admin.guests.editor.child")}
                  checked={row.isChild}
                  onChange={(event) =>
                    patch(row.key, {
                      isChild: event.target.checked,
                      age: event.target.checked ? row.age : "",
                    })
                  }
                />
                {row.isChild ? (
                  <Field
                    id={`${idPrefix}-age-${row.key}`}
                    label={t("admin.guests.editor.age")}
                    hint={t("admin.guests.editor.ageHint")}
                    inputMode="numeric"
                    autoComplete="off"
                    value={row.age}
                    maxLength={2}
                    className="max-w-40"
                    error={problems[row.key]?.age ? t("admin.guests.editor.error.age") : undefined}
                    onChange={(event) => patch(row.key, { age: event.target.value })}
                  />
                ) : null}
                <Fieldset legend={t("admin.guests.editor.invited")}>
                  {events.length === 0 ? (
                    <p className="text-muted">
                      {t("admin.guests.editor.noEvents")}{" "}
                      <a href={eventsHref} className="text-pine underline underline-offset-4">
                        {t("admin.guests.editor.noEventsLink")}
                      </a>
                    </p>
                  ) : (
                    events.map((eventOption) => (
                      <Checkbox
                        key={eventOption.id}
                        label={eventOption.title}
                        checked={row.eventIds.includes(eventOption.id)}
                        onChange={(event) =>
                          toggleEvent(row.key, eventOption.id, event.target.checked)
                        }
                      />
                    ))
                  )}
                </Fieldset>
              </div>
            </Card>
          </li>
        ))}
      </ol>

      <div>
        <Button
          id={`${idPrefix}-add`}
          type="button"
          variant="secondary"
          disabled={rows.length >= GUEST_LIMITS.guestsPerHousehold}
          onClick={addGuest}
        >
          <Icon icon={Plus} size={18} />
          {t("admin.guests.editor.addGuest")}
        </Button>
      </div>

      {answered ? <p className="text-muted">{t("admin.guests.editor.answeredNote")}</p> : null}

      <FormAlert>{error ? t(error) : null}</FormAlert>
      <StatusMessage state={state}>
        {state === "busy" ? t("admin.common.saving") : t("admin.guests.editor.saved")}
      </StatusMessage>

      <div className="flex flex-wrap items-start gap-3">
        <Button type="submit" disabled={state === "busy"}>
          {t("admin.guests.editor.save")}
        </Button>
        <a
          href={listHref}
          className="min-h-target text-pine inline-flex items-center px-3 underline underline-offset-4"
        >
          {t("admin.guests.editor.cancel")}
        </a>
        {householdId ? (
          <ConfirmButton
            label={t("admin.guests.editor.delete")}
            question={t("admin.guests.editor.deleteQuestion")}
            confirmLabel={t("admin.guests.editor.deleteConfirm")}
            disabled={state === "busy"}
            onConfirm={remove}
          />
        ) : null}
      </div>
    </form>
  );
}
