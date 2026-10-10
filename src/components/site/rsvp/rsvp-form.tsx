"use client";

import { Check, CircleAlert, Plus, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ReactNode,
  type RefObject,
} from "react";
import { Icon } from "@/components/ui/icon";
import { newNonce } from "@/lib/nonce";
import {
  answerField,
  attendanceField,
  extraField,
  fieldId,
  guestField,
  type Attendance,
  type DoneSummary,
  type FieldErrors,
  type FormExtra,
  type FormValues,
  type RsvpFormModel,
  type RsvpState,
} from "@/lib/rsvp/form";
import { matchAction, resetAction, submitAction, unlistedAction } from "../actions";
import { fill, type RsvpLabels } from "./labels";

/**
 * Formulář RSVP hosta (FR-RSVP-1 až 7). Krok 1: jméno do prázdného pole (bez našeptávače a výpisu
 * hostů), tiché porovnání na serveru. Krok 2: formulář domácnosti nebo hosta mimo seznam, větvení
 * podle pozvaných událostí, otázky podle nastavení páru. Odeslání a úprava jsou tentýž formulář.
 *
 * Přístupnost: viditelné popisky a legendy, chyby slovy u pole i v souhrnu s odkazy (WCAG 3.3.1,
 * 3.3.3), `autocomplete` u jména a e-mailu (1.3.5), nic se po chybě nepíše znovu (3.3.7; hodnoty
 * zůstávají ve stavu), potvrzení se oznámí čtečce živou oblastí bez přesunu zaměření (4.1.3),
 * stav vždy textem s ikonou, cíle alespoň 44 px (CSS `site.css`).
 */

export interface RsvpFormProps {
  labels: RsvpLabels;
  locale: string;
  initial: RsvpState;
  allowUnlisted: boolean;
  /** Konec potvrzování, hotové datum ("30. dubna 2027"), nebo `null`. */
  closes: string | null;
}

const EMPTY_VALUES: FormValues = {
  attendance: {},
  diet: {},
  allergies: {},
  extras: [],
  answers: {},
  email: "",
};

const NEW_ADULT: FormExtra = {
  kind: "adult",
  name: "",
  age: "",
  attendance: {},
  diet: "",
  allergies: "",
};
const NEW_CHILD: FormExtra = {
  kind: "child",
  name: "",
  age: "",
  attendance: {},
  diet: "",
  allergies: "",
};

export function RsvpForm({ labels, locale, initial, allowUnlisted, closes }: RsvpFormProps) {
  const [stage, setStage] = useState(initial.stage);
  const [flow, setFlow] = useState<RsvpState["error"]>(initial.error);
  const [model, setModel] = useState<RsvpFormModel | undefined>(initial.model);
  const [values, setValues] = useState<FormValues>(initial.model?.values ?? EMPTY_VALUES);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [done, setDone] = useState<DoneSummary | undefined>(initial.done);
  const [name, setName] = useState(initial.value ?? "");
  const [pending, startTransition] = useTransition();
  const summaryRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const [focusSummary, setFocusSummary] = useState(0);
  const [nameAnswers, setNameAnswers] = useState(0);
  // Roste, když se formulář hosta objeví jako nový krok (po shodě jména, po volbě hosta mimo seznam).
  const [formEntered, setFormEntered] = useState(0);

  function apply(next: RsvpState, typedName?: string) {
    setStage(next.stage);
    setFlow(next.error);
    setErrors(next.errors ?? {});
    setDone(next.done);
    if (next.value !== undefined) setName(next.value);
    if (next.model) {
      setModel(next.model);
      // Host mimo seznam: první osoba je ten, kdo se právě představil, jméno se nepíše podruhé (WCAG 3.3.7).
      const typed = typedName?.trim().slice(0, 200);
      const first = next.model.values.extras[0];
      setValues(
        next.model.mode === "unlisted" && typed && first && first.name === ""
          ? {
              ...next.model.values,
              extras: [{ ...first, name: typed }, ...next.model.values.extras.slice(1)],
            }
          : next.model.values,
      );
    }
    if (next.errors && Object.keys(next.errors).length > 0) setFocusSummary((n) => n + 1);
    // Pole jména se zaměří po chybě i po návratu na první krok ("Zadat jiné jméno").
    if (next.stage === "name" && (next.error || stage !== "name")) setNameAnswers((n) => n + 1);
    // Krok 1 zmizel: zaměření přejde na začátek formuláře, jinak by spadlo na `body`.
    if (next.stage !== "name" && next.model && !next.error && stage === "name") {
      setFormEntered((n) => n + 1);
    }
  }

  function run(
    action: (formData: FormData) => Promise<RsvpState>,
    formData: FormData,
    typedName?: string,
  ) {
    formData.set("locale", locale);
    startTransition(async () => {
      let next: RsvpState;
      try {
        next = await action(formData);
      } catch {
        next = { stage, error: "generic" };
      }
      startTransition(() => apply(next, typedName));
    });
  }

  // Po chybě zaměření na souhrn chyb (kromě toho, co už zná čtečka z živé oblasti).
  useEffect(() => {
    if (focusSummary > 0) summaryRef.current?.focus();
  }, [focusSummary]);

  // Odpověď hosta mimo seznam už nejde upravit: formulář zmizí, zaměření přejde na potvrzení.
  const unlistedDone = done !== undefined && model?.mode === "unlisted";
  useEffect(() => {
    if (unlistedDone) doneRef.current?.focus();
  }, [unlistedDone]);

  const flowMessage = flow ? flowErrorText(flow, labels) : undefined;

  return (
    <div className="site-rsvp">
      {closes ? (
        <p className="site-muted site-rsvp-closes">{fill(labels.closesAt, { date: closes })}</p>
      ) : null}

      {/* Živá oblast je v DOM vždy: potvrzení se oznámí, aniž by se přesunulo zaměření (WCAG 4.1.3). */}
      <div role="status" aria-live="polite" aria-atomic="true" className="site-rsvp-live">
        {done ? (
          <p className="site-done-title">
            <Icon icon={Check} size={22} />
            <span>{labels.done.title}</span>
          </p>
        ) : null}
      </div>

      <div role="alert" className="site-alert-slot">
        {flowMessage && stage !== "name" ? (
          <p className="site-error">
            <Icon icon={CircleAlert} size={20} />
            <span>{flowMessage}</span>
          </p>
        ) : null}
      </div>

      {stage === "closed" ? (
        <p className="site-rsvp-status">{labels.errors.closed}</p>
      ) : stage === "name" || !model ? (
        <NameStep
          labels={labels}
          name={name}
          setName={setName}
          pending={pending}
          flow={flow}
          focusKey={nameAnswers}
          allowUnlisted={allowUnlisted}
          onSubmit={(formData) => run(matchAction, formData)}
          onUnlisted={() => run(unlistedAction, new FormData(), name)}
        />
      ) : unlistedDone && done ? (
        <div ref={doneRef} tabIndex={-1} className="site-done">
          <DoneDetails labels={labels} done={done} />
        </div>
      ) : (
        <>
          {done ? <DoneDetails labels={labels} done={done} /> : null}
          <GuestForm
            labels={labels}
            model={model}
            values={values}
            setValues={setValues}
            errors={errors}
            pending={pending}
            saved={done !== undefined || model.existing}
            summaryRef={summaryRef}
            enterKey={formEntered}
            onSubmit={(formData) => run(submitAction, formData)}
            onOtherName={() => {
              setDone(undefined);
              setErrors({});
              run(resetAction, new FormData());
            }}
          />
        </>
      )}
    </div>
  );
}

function flowErrorText(error: NonNullable<RsvpState["error"]>, labels: RsvpLabels): string {
  switch (error) {
    case "name_required":
      return labels.name.errors.required;
    case "not_found":
      return labels.name.errors.notFound;
    case "expired":
      return labels.errors.expired;
    case "limited":
      return labels.errors.limited;
    case "closed":
      return labels.errors.closed;
    case "invalid":
      return labels.errors.failed;
    case "generic":
      return labels.errors.generic;
  }
}

// --- krok 1: jméno -------------------------------------------------------------------------

function NameStep({
  labels,
  name,
  setName,
  pending,
  flow,
  focusKey,
  allowUnlisted,
  onSubmit,
  onUnlisted,
}: {
  labels: RsvpLabels;
  name: string;
  setName: (value: string) => void;
  pending: boolean;
  flow: RsvpState["error"];
  /** Roste s každou odpovědí serveru na jméno, aby se pole zaměřilo i při stejné chybě podruhé. */
  focusKey: number;
  allowUnlisted: boolean;
  onSubmit: (formData: FormData) => void;
  onUnlisted: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const message = flow ? flowErrorText(flow, labels) : undefined;

  useEffect(() => {
    if (focusKey > 0) input.current?.focus();
  }, [focusKey]);

  return (
    <form
      className="site-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        // Tlačítko není `disabled` (zaměření by zmizelo), dvojí odeslání hlídá tady.
        if (!pending) onSubmit(new FormData(event.currentTarget));
      }}
    >
      <div className="site-field">
        <label htmlFor={`${id}-name`} className="site-field-label">
          {labels.name.label}
        </label>
        <p id={`${id}-hint`} className="site-muted site-hint">
          {labels.name.hint} {labels.name.privacy}
        </p>
        {/* Prázdné pole bez našeptávače (žádný `list`), jen vlastní jméno prohlížeče (`name`). */}
        <input
          ref={input}
          id={`${id}-name`}
          name="name"
          type="text"
          autoComplete="name"
          autoCapitalize="words"
          spellCheck={false}
          maxLength={200}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={message ? true : undefined}
          aria-describedby={`${id}-hint${message ? ` ${id}-error` : ""}`}
          className="site-input"
        />
        <div role="alert" className="site-alert-slot">
          {message ? (
            <p id={`${id}-error`} className="site-error">
              <Icon icon={CircleAlert} size={20} />
              <span>{message}</span>
            </p>
          ) : null}
        </div>
      </div>
      <Honeypot label={labels.honeypot} />
      <div className="site-actions">
        <button type="submit" className="site-btn" aria-disabled={pending || undefined}>
          {pending ? labels.name.searching : labels.name.submit}
        </button>
      </div>
      {allowUnlisted ? (
        <div className="site-unlisted">
          <p className="site-muted">{labels.unlisted.prompt}</p>
          <button type="button" className="site-btn site-btn-secondary" onClick={onUnlisted}>
            {labels.unlisted.button}
          </button>
        </div>
      ) : null}
    </form>
  );
}

/**
 * Skrytá past proti robotům (ADR 0010, bez hádanek: WCAG 3.3.8). Pole je mimo obrazovku, nejde do něj
 * tabulátorem a čtečka ho nevidí; poctivý host ho nevyplní.
 */
function Honeypot({ label }: { label: string }) {
  const id = useId();
  return (
    <div className="site-hp" aria-hidden="true">
      <label htmlFor={id}>{label}</label>
      <input id={id} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
    </div>
  );
}

// --- potvrzení -----------------------------------------------------------------------------

function DoneDetails({ labels, done }: { labels: RsvpLabels; done: DoneSummary }) {
  return (
    <div className="site-done-details">
      {done.emailSent ? <p>{labels.done.email}</p> : null}
      {done.updates === true ? <p>{labels.done.updatesOn}</p> : null}
      {done.updates === false ? <p>{labels.done.updatesOff}</p> : null}
      <p>{done.unlisted ? labels.unlisted.noEdit : labels.done.edit}</p>
      {done.people.length > 0 ? (
        <>
          <h3 className="site-h3">{labels.done.summary}</h3>
          <ul className="site-summary">
            {done.people.map((person, index) => (
              <li key={index}>
                <strong>{person.name}</strong>
                <ul>
                  {person.rows.map((row, rowIndex) => (
                    <li key={rowIndex} className="site-summary-row">
                      <Icon icon={row.attending ? Check : X} size={18} />
                      <span>
                        {row.event}: {row.attending ? labels.done.attending : labels.done.declining}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

// --- krok 2: formulář ----------------------------------------------------------------------

function errorText(
  name: string,
  code: NonNullable<FieldErrors[string]>,
  labels: RsvpLabels,
  radio = false,
) {
  switch (code) {
    case "required":
      if (/\.ev\./.test(name)) return labels.errors.attendance;
      return radio ? labels.errors.choice : labels.errors.required;
    case "name":
      return labels.errors.name;
    case "age":
      return labels.errors.age;
    case "email":
      return labels.errors.email;
    case "phone":
      return labels.errors.phone;
    case "too_long":
      return labels.errors.tooLong;
    case "choice":
      return labels.errors.choice;
    case "invalid":
      return labels.errors.invalid;
  }
}

function GuestForm({
  labels,
  model,
  values,
  setValues,
  errors,
  pending,
  saved,
  summaryRef,
  enterKey,
  onSubmit,
  onOtherName,
}: {
  labels: RsvpLabels;
  model: RsvpFormModel;
  values: FormValues;
  setValues: (update: (current: FormValues) => FormValues) => void;
  errors: FieldErrors;
  pending: boolean;
  saved: boolean;
  summaryRef: RefObject<HTMLDivElement | null>;
  /** Roste, když se formulář objevil jako nový krok; úvod se zaměří (i hned po vykreslení). */
  enterKey: number;
  onSubmit: (formData: FormData) => void;
  onOtherName: () => void;
}) {
  const unlisted = model.mode === "unlisted";
  // Idempotenční klíč tohoto formuláře: dvojklik i opakování po chybě sítě odešle týž klíč, takže server
  // odpověď hosta mimo seznam nezaloží dvakrát. Po úspěchu formulář zmizí, nový formulář má nový klíč.
  const nonce = useRef<string | null>(null);
  const introRef = useRef<HTMLParagraphElement>(null);
  const addPersonRef = useRef<HTMLButtonElement>(null);
  const addChildRef = useRef<HTMLButtonElement>(null);
  // Kam přesunout zaměření po změně počtu osob (vyřídí efekt po vykreslení).
  const pendingFocus = useRef<
    { kind: "name"; index: number } | { kind: "add"; child: boolean } | null
  >(null);

  useEffect(() => {
    if (enterKey > 0) introRef.current?.focus();
  }, [enterKey]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target.kind === "name") {
      const field = document.getElementById(fieldId(`${extraField(target.index)}.name`));
      field?.focus();
    } else {
      (target.child ? addChildRef.current : addPersonRef.current)?.focus();
    }
  });

  const eventById = new Map(model.events.map((event) => [event.id, event]));
  const adults = values.extras.filter((extra) => extra.kind === "adult");
  const hasPlusOne = !unlisted && adults.length > 0;

  const personCount = model.guests.length + values.extras.length;
  const attendingEvents = new Set<string>();
  for (const guest of model.guests) {
    for (const eventId of guest.eventIds) {
      if (values.attendance[attendanceField(guestField(guest.id), eventId)] === "yes") {
        attendingEvents.add(eventId);
      }
    }
  }
  for (const extra of values.extras) {
    for (const event of model.events) {
      if (extra.attendance[event.id] === "yes") attendingEvents.add(event.id);
    }
  }

  function setAttendance(field: string, value: Attendance) {
    setValues((current) => ({ ...current, attendance: { ...current.attendance, [field]: value } }));
  }

  function setExtra(index: number, patch: Partial<FormExtra>) {
    setValues((current) => ({
      ...current,
      extras: current.extras.map((extra, i) => (i === index ? { ...extra, ...patch } : extra)),
    }));
  }

  function setAll(eventId: string, value: Attendance) {
    setValues((current) => {
      const attendance = { ...current.attendance };
      for (const guest of model.guests) {
        if (guest.eventIds.includes(eventId)) {
          attendance[attendanceField(guestField(guest.id), eventId)] = value;
        }
      }
      return {
        ...current,
        attendance,
        extras: current.extras.map((extra) => ({
          ...extra,
          attendance: { ...extra.attendance, [eventId]: value },
        })),
      };
    });
  }

  function togglePlusOne(on: boolean) {
    setValues((current) => {
      const withoutAdult = current.extras.filter((extra) => extra.kind !== "adult");
      return { ...current, extras: on ? [NEW_ADULT, ...withoutAdult] : withoutAdult };
    });
  }

  function addExtra(extra: FormExtra) {
    pendingFocus.current = { kind: "name", index: values.extras.length };
    setValues((current) => ({ ...current, extras: [...current.extras, extra] }));
  }

  function removeExtra(index: number) {
    // Odebraná osoba zmizela i se zaměřeným tlačítkem: zaměření dostane tlačítko Přidat.
    pendingFocus.current = { kind: "add", child: values.extras[index]?.kind === "child" };
    setValues((current) => ({ ...current, extras: current.extras.filter((_, i) => i !== index) }));
  }

  function extraLabel(extra: FormExtra, index: number): string {
    if (extra.kind === "child") {
      const n = values.extras.slice(0, index + 1).filter((e) => e.kind === "child").length;
      return fill(labels.child.heading, { n });
    }
    if (unlisted) {
      const n = values.extras.slice(0, index + 1).filter((e) => e.kind === "adult").length;
      return fill(labels.unlisted.person, { n });
    }
    return labels.plus.heading;
  }

  const errorEntries = Object.entries(errors);

  /** Text souhrnu chyb: kdo nebo co + co je špatně. */
  function summaryItem(field: string, code: NonNullable<FieldErrors[string]>): string {
    const question = field.startsWith("a.")
      ? model.questions.find((q) => q.key === field.slice(2))
      : undefined;
    const isRadio =
      (question !== undefined && question.type !== "text") ||
      field === answerField("lodging") ||
      field === answerField("transport");
    const message = errorText(field, code, labels, isRadio);
    let context = "";
    const guestMatch = /^g\.([^.]+)\.(?:ev\.(.+)|diet|allergies)$/.exec(field);
    const extraMatch = /^x\.(\d+)\.(?:ev\.(.+)|name|age|kind|diet|allergies)$/.exec(field);
    if (guestMatch) {
      const guest = model.guests.find((g) => g.id === guestMatch[1]);
      const event = guestMatch[2] ? eventById.get(guestMatch[2]) : undefined;
      context = [guest?.name, event?.title].filter(Boolean).join(": ");
    } else if (extraMatch) {
      const index = Number(extraMatch[1]);
      const extra = values.extras[index];
      const event = extraMatch[2] ? eventById.get(extraMatch[2]) : undefined;
      context = [extra ? extraLabel(extra, index) : "", event?.title].filter(Boolean).join(": ");
    } else if (field === "email") {
      context = labels.email.label;
    } else if (field === "updatesEmail") {
      context = labels.updates.email;
    } else if (field === "updatesPhone") {
      context = labels.updates.phone;
    } else if (field.startsWith("a.")) {
      const key = field.slice(2);
      context = model.questions.find((q) => q.key === key)?.label ?? questionTitle(key, labels);
    }
    return context ? `${context}: ${message}` : message;
  }

  function jumpTo(field: string) {
    const target = document.getElementById(fieldId(field));
    const focusable = target?.matches("input, textarea")
      ? target
      : target?.querySelector("input, textarea");
    (focusable as HTMLElement | null)?.focus();
  }

  const visibleQuestions = model.questions.filter(
    (question) => question.eventId === null || attendingEvents.has(question.eventId),
  );
  const submitLabel = pending
    ? labels.submit.sending
    : saved
      ? labels.submit.save
      : labels.submit.send;

  return (
    <form
      className="site-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const formData = new FormData(event.currentTarget);
        formData.set("mode", model.mode);
        nonce.current ??= newNonce();
        formData.set("nonce", nonce.current);
        onSubmit(formData);
      }}
    >
      {!unlisted ? (
        <>
          <p ref={introRef} tabIndex={-1} className="site-muted">
            {model.existing ? labels.form.introEdit : labels.form.introListed}
          </p>
          <p className="site-muted site-hint">
            {labels.form.notYou}{" "}
            <button type="button" className="site-linkbutton" onClick={onOtherName}>
              {labels.form.otherName}
            </button>
          </p>
        </>
      ) : (
        <p ref={introRef} tabIndex={-1} className="site-muted">
          {labels.unlisted.intro}
        </p>
      )}
      <p className="site-muted site-hint">{labels.form.required}</p>

      {errorEntries.length > 0 ? (
        <div ref={summaryRef} tabIndex={-1} className="site-error-summary">
          <p className="site-error-summary-title">
            <Icon icon={CircleAlert} size={22} />
            <span>{labels.errors.summary}</span>
          </p>
          <ul>
            {errorEntries.map(([field, code]) => (
              <li key={field}>
                <a
                  href={`#${fieldId(field)}`}
                  onClick={(event) => {
                    event.preventDefault();
                    jumpTo(field);
                  }}
                >
                  {summaryItem(field, code)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Rychlá volba pro celou domácnost: stejná odpověď se nemusí klikat u každého jména (3.3.7). */}
      {personCount > 1 && model.events.length > 0 ? (
        <div className="site-quick">
          {model.events.map((event) => (
            <div
              key={event.id}
              role="group"
              aria-label={fill(labels.form.allLabel, { event: event.title })}
              className="site-quick-row"
            >
              <span lang={event.titleLang} className="site-quick-title">
                {event.title}
              </span>
              <button
                type="button"
                className="site-btn site-btn-secondary"
                onClick={() => setAll(event.id, "yes")}
              >
                {labels.form.allYes}
              </button>
              <button
                type="button"
                className="site-btn site-btn-secondary"
                onClick={() => setAll(event.id, "no")}
              >
                {labels.form.allNo}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {model.guests.map((guest) => {
        const prefix = guestField(guest.id);
        const title = guest.isChild
          ? fill(labels.form.childSuffix, { name: guest.name })
          : guest.name;
        return (
          <section key={guest.id} className="site-person" aria-labelledby={fieldId(`${prefix}-h`)}>
            <h3 id={fieldId(`${prefix}-h`)} className="site-h3">
              {title}
            </h3>
            {guest.eventIds.map((eventId) => {
              const event = eventById.get(eventId);
              if (!event) return null;
              const field = attendanceField(prefix, eventId);
              return (
                <AttendanceGroup
                  key={field}
                  field={field}
                  legend={fill(labels.form.eventLegend, { person: guest.name, event: event.title })}
                  legendLang={event.titleLang}
                  when={fill(labels.form.eventWhen, { when: event.when })}
                  value={values.attendance[field]}
                  error={errors[field] ? errorText(field, errors[field], labels) : undefined}
                  labels={labels}
                  onChange={(value) => setAttendance(field, value)}
                />
              );
            })}
            {model.flags.diet ? (
              <HealthFields
                prefix={prefix}
                name={guest.name}
                labels={labels}
                diet={values.diet[prefix] ?? ""}
                allergies={values.allergies[prefix] ?? ""}
                saved={values.savedHealth?.[prefix] === true}
                errors={errors}
                onDiet={(value) =>
                  setValues((c) => ({ ...c, diet: { ...c.diet, [prefix]: value } }))
                }
                onAllergies={(value) =>
                  setValues((c) => ({ ...c, allergies: { ...c.allergies, [prefix]: value } }))
                }
              />
            ) : null}
          </section>
        );
      })}

      {!unlisted && model.flags.plusOne ? (
        <label className="site-choice site-plus-toggle">
          <input
            type="checkbox"
            checked={hasPlusOne}
            onChange={(event) => togglePlusOne(event.target.checked)}
          />
          <span>{labels.plus.toggle}</span>
        </label>
      ) : null}

      {values.extras.map((extra, index) => {
        const prefix = extraField(index);
        const title = extraLabel(extra, index);
        const isChild = extra.kind === "child";
        const removable = isChild || (unlisted && index > 0);
        const nameField = `${prefix}.name`;
        return (
          <section key={index} className="site-person" aria-labelledby={fieldId(`${prefix}-h`)}>
            <h3 id={fieldId(`${prefix}-h`)} className="site-h3">
              {title}
            </h3>
            <input type="hidden" name={`${prefix}.kind`} value={extra.kind} />
            <TextField
              field={nameField}
              label={
                isChild
                  ? labels.child.name
                  : unlisted
                    ? index === 0
                      ? labels.unlisted.you
                      : labels.unlisted.personName
                    : labels.plus.name
              }
              hint={!isChild && !unlisted ? labels.plus.nameHint : undefined}
              value={extra.name}
              autoComplete={unlisted && index === 0 ? "name" : "off"}
              maxLength={200}
              required
              error={
                errors[nameField] ? errorText(nameField, errors[nameField], labels) : undefined
              }
              onChange={(value) => setExtra(index, { name: value })}
            />
            {isChild ? (
              <TextField
                field={`${prefix}.age`}
                label={labels.child.age}
                value={extra.age}
                inputMode="numeric"
                autoComplete="off"
                maxLength={2}
                required
                narrow
                error={
                  errors[`${prefix}.age`]
                    ? errorText(`${prefix}.age`, errors[`${prefix}.age`], labels)
                    : undefined
                }
                onChange={(value) => setExtra(index, { age: value })}
              />
            ) : null}
            {model.events.map((event) => {
              const field = attendanceField(prefix, event.id);
              return (
                <AttendanceGroup
                  key={field}
                  field={field}
                  legend={fill(labels.form.eventLegend, {
                    person: extra.name.trim() || title,
                    event: event.title,
                  })}
                  legendLang={event.titleLang}
                  when={fill(labels.form.eventWhen, { when: event.when })}
                  value={extra.attendance[event.id]}
                  error={errors[field] ? errorText(field, errors[field], labels) : undefined}
                  labels={labels}
                  onChange={(value) =>
                    setExtra(index, { attendance: { ...extra.attendance, [event.id]: value } })
                  }
                />
              );
            })}
            {model.flags.diet ? (
              <HealthFields
                prefix={prefix}
                name={extra.name.trim() || title}
                labels={labels}
                diet={extra.diet}
                allergies={extra.allergies}
                saved={extra.savedHealth === true}
                savedName={extra.savedName}
                errors={errors}
                onDiet={(value) => setExtra(index, { diet: value })}
                onAllergies={(value) => setExtra(index, { allergies: value })}
              />
            ) : null}
            {removable ? (
              <button
                type="button"
                className="site-btn site-btn-secondary"
                onClick={() => removeExtra(index)}
              >
                <Icon icon={X} size={18} />
                <span>
                  {isChild
                    ? fill(labels.child.remove, {
                        n: values.extras.slice(0, index + 1).filter((e) => e.kind === "child")
                          .length,
                      })
                    : fill(labels.unlisted.removePerson, { n: index + 1 })}
                </span>
              </button>
            ) : null}
          </section>
        );
      })}

      {(unlisted || model.flags.children) && values.extras.length < 20 ? (
        <div className="site-actions">
          {unlisted ? (
            <button
              ref={addPersonRef}
              type="button"
              className="site-btn site-btn-secondary"
              onClick={() => addExtra(NEW_ADULT)}
            >
              <Icon icon={Plus} size={18} />
              <span>{labels.unlisted.addPerson}</span>
            </button>
          ) : null}
          {model.flags.children ? (
            <button
              ref={addChildRef}
              type="button"
              className="site-btn site-btn-secondary"
              onClick={() => addExtra(NEW_CHILD)}
            >
              <Icon icon={Plus} size={18} />
              <span>{labels.child.add}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Otázky podle nastavení páru; vázané na událost se ptají jen toho, kdo na ni přijde. */}
      {model.flags.lodging ? (
        <ChoiceGroup
          field={answerField("lodging")}
          legend={labels.questions.lodging.legend}
          options={[
            { value: "need", label: labels.questions.lodging.need },
            { value: "own", label: labels.questions.lodging.own },
            { value: "unsure", label: labels.questions.lodging.unsure },
          ]}
          value={values.answers.lodging}
          error={errors[answerField("lodging")] ? labels.errors.choice : undefined}
          onChange={(value) => setAnswer(setValues, "lodging", value)}
        />
      ) : null}
      {model.flags.transport ? (
        <ChoiceGroup
          field={answerField("transport")}
          legend={labels.questions.transport.legend}
          options={[
            { value: "need", label: labels.questions.transport.need },
            { value: "own", label: labels.questions.transport.own },
            { value: "offer", label: labels.questions.transport.offer },
          ]}
          value={values.answers.transport}
          error={errors[answerField("transport")] ? labels.errors.choice : undefined}
          onChange={(value) => setAnswer(setValues, "transport", value)}
        />
      ) : null}
      {model.flags.song ? (
        <TextField
          field={answerField("song")}
          label={labels.questions.song.label}
          hint={labels.questions.song.hint}
          value={values.answers.song ?? ""}
          autoComplete="off"
          maxLength={200}
          error={
            errors[answerField("song")]
              ? errorText(answerField("song"), errors[answerField("song")], labels)
              : undefined
          }
          onChange={(value) => setAnswer(setValues, "song", value)}
        />
      ) : null}
      {model.flags.message ? (
        <TextField
          field={answerField("message")}
          label={labels.questions.message.label}
          hint={labels.questions.message.hint}
          value={values.answers.message ?? ""}
          autoComplete="off"
          maxLength={1000}
          multiline
          error={
            errors[answerField("message")]
              ? errorText(answerField("message"), errors[answerField("message")], labels)
              : undefined
          }
          onChange={(value) => setAnswer(setValues, "message", value)}
        />
      ) : null}
      {visibleQuestions.map((question) => {
        const field = answerField(question.key);
        const error = errors[field]
          ? errorText(field, errors[field], labels, question.type !== "text")
          : undefined;
        const legend = question.required
          ? `${question.label} (${labels.questions.required})`
          : question.label;
        if (question.type === "text") {
          return (
            <TextField
              key={question.key}
              field={field}
              label={legend}
              labelLang={question.labelLang}
              hint={
                model.flags.diet
                  ? labels.questions.noHealthDietOn
                  : labels.questions.noHealthDietOff
              }
              value={values.answers[question.key] ?? ""}
              autoComplete="off"
              maxLength={1000}
              required={question.required}
              error={error}
              onChange={(value) => setAnswer(setValues, question.key, value)}
            />
          );
        }
        return (
          <ChoiceGroup
            key={question.key}
            field={field}
            legend={legend}
            legendLang={question.labelLang}
            options={
              question.type === "bool"
                ? [
                    { value: "yes", label: labels.questions.yes },
                    { value: "no", label: labels.questions.no },
                  ]
                : question.options
            }
            value={values.answers[question.key]}
            required={question.required}
            error={error}
            onChange={(value) => setAnswer(setValues, question.key, value)}
          />
        );
      })}

      {model.flags.emailConfirmation ? (
        <EmailField labels={labels} values={values} setValues={setValues} errors={errors} />
      ) : null}

      {model.flags.updates ? (
        <UpdatesFields labels={labels} values={values} setValues={setValues} errors={errors} />
      ) : null}

      <Honeypot label={labels.honeypot} />

      <div className="site-actions">
        <button type="submit" className="site-btn" aria-disabled={pending || undefined}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function questionTitle(key: string, labels: RsvpLabels): string {
  if (key === "lodging") return labels.questions.lodging.legend;
  if (key === "transport") return labels.questions.transport.legend;
  if (key === "song") return labels.questions.song.label;
  if (key === "message") return labels.questions.message.label;
  return key;
}

function setAnswer(
  setValues: (update: (current: FormValues) => FormValues) => void,
  key: string,
  value: string,
) {
  setValues((current) => ({ ...current, answers: { ...current.answers, [key]: value } }));
}

function EmailField({
  labels,
  values,
  setValues,
  errors,
}: {
  labels: RsvpLabels;
  values: FormValues;
  setValues: (update: (current: FormValues) => FormValues) => void;
  errors: FieldErrors;
}) {
  return (
    <>
      {values.savedEmail ? <input type="hidden" name="emailSaved" value="1" /> : null}
      <TextField
        field="email"
        label={labels.email.label}
        hint={values.savedEmail ? `${labels.email.hint} ${labels.email.saved}` : labels.email.hint}
        type="email"
        inputMode="email"
        autoComplete="email"
        value={values.email}
        maxLength={254}
        error={errors.email ? errorText("email", errors.email, labels) : undefined}
        onChange={(value) => setValues((current) => ({ ...current, email: value }))}
      />
    </>
  );
}

/**
 * Upozornění na změny: souhlas zaškrtnutím, pak e-mail (povinný) a telefon (nepovinný). Uložené údaje
 * host nevidí (lístek z jména dostane kdokoli, kdo jméno zná); prázdné pole je ponechá, zrušení
 * zaškrtnutí je smaže.
 */
function UpdatesFields({
  labels,
  values,
  setValues,
  errors,
}: {
  labels: RsvpLabels;
  values: FormValues;
  setValues: (update: (current: FormValues) => FormValues) => void;
  errors: FieldErrors;
}) {
  const id = fieldId("updates");
  const on = values.updates === true;
  return (
    <fieldset
      className="site-fieldset site-updates"
      aria-describedby={values.savedUpdates ? `${id}-saved` : undefined}
    >
      <legend className="site-legend">{labels.updates.legend}</legend>
      {values.savedUpdates ? (
        <>
          <input type="hidden" name="updatesSaved" value="1" />
          <p id={`${id}-saved`} className="site-muted site-hint">
            {labels.updates.saved}
          </p>
        </>
      ) : null}
      <label className="site-choice">
        <input
          id={id}
          type="checkbox"
          name="updates"
          value="1"
          checked={on}
          onChange={(event) =>
            setValues((current) => ({ ...current, updates: event.target.checked }))
          }
        />
        <span>{labels.updates.consent}</span>
      </label>
      {on ? (
        <>
          <TextField
            field="updatesEmail"
            label={labels.updates.email}
            hint={labels.updates.emailHint}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={values.updatesEmail ?? ""}
            maxLength={254}
            required={!values.savedUpdates}
            error={
              errors.updatesEmail
                ? errorText("updatesEmail", errors.updatesEmail, labels)
                : undefined
            }
            onChange={(value) => setValues((current) => ({ ...current, updatesEmail: value }))}
          />
          <TextField
            field="updatesPhone"
            label={labels.updates.phone}
            hint={labels.updates.phoneHint}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={values.updatesPhone ?? ""}
            maxLength={30}
            error={
              errors.updatesPhone
                ? errorText("updatesPhone", errors.updatesPhone, labels)
                : undefined
            }
            onChange={(value) => setValues((current) => ({ ...current, updatesPhone: value }))}
          />
        </>
      ) : null}
    </fieldset>
  );
}

// --- stavební prvky ------------------------------------------------------------------------

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="site-error">
      <Icon icon={CircleAlert} size={20} />
      <span>{children}</span>
    </p>
  );
}

function TextField({
  field,
  label,
  labelLang,
  hint,
  value,
  onChange,
  error,
  type = "text",
  inputMode,
  autoComplete,
  maxLength,
  required,
  narrow,
  multiline,
}: {
  field: string;
  label: string;
  labelLang?: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: "text" | "email" | "tel";
  inputMode?: "numeric" | "email" | "tel";
  autoComplete?: string;
  maxLength?: number;
  required?: boolean;
  narrow?: boolean;
  /** Víceřádkové pole (vzkaz). */
  multiline?: boolean;
}) {
  const id = fieldId(field);
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="site-field">
      <label htmlFor={id} className="site-field-label" lang={labelLang}>
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="site-muted site-hint">
          {hint}
        </p>
      ) : null}
      {multiline ? (
        <textarea
          id={id}
          name={field}
          autoComplete={autoComplete}
          maxLength={maxLength}
          required={required}
          rows={4}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className="site-input site-textarea"
        />
      ) : (
        <input
          id={id}
          name={field}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          maxLength={maxLength}
          required={required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={narrow ? "site-input site-input-narrow" : "site-input"}
        />
      )}
      <div aria-live="polite">
        {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
      </div>
    </div>
  );
}

function AttendanceGroup({
  field,
  legend,
  legendLang,
  when,
  value,
  error,
  labels,
  onChange,
}: {
  field: string;
  legend: string;
  legendLang?: string;
  when: string;
  value: Attendance | undefined;
  error?: string;
  labels: RsvpLabels;
  onChange: (value: Attendance) => void;
}) {
  const id = fieldId(field);
  return (
    <fieldset
      id={id}
      className="site-fieldset"
      aria-describedby={`${id}-when${error ? ` ${id}-error` : ""}`}
    >
      <legend lang={legendLang} className="site-legend">
        {legend}
      </legend>
      <p id={`${id}-when`} className="site-muted site-hint">
        {when}
      </p>
      <div className="site-choice-row">
        <label className="site-choice">
          <input
            type="radio"
            name={field}
            value="yes"
            required
            checked={value === "yes"}
            onChange={() => onChange("yes")}
          />
          <span>{labels.form.attends}</span>
        </label>
        <label className="site-choice">
          <input
            type="radio"
            name={field}
            value="no"
            required
            checked={value === "no"}
            onChange={() => onChange("no")}
          />
          <span>{labels.form.declines}</span>
        </label>
      </div>
      <div aria-live="polite">
        {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
      </div>
    </fieldset>
  );
}

function ChoiceGroup({
  field,
  legend,
  legendLang,
  options,
  value,
  required,
  error,
  onChange,
}: {
  field: string;
  legend: string;
  legendLang?: string;
  options: { value: string; label: string }[];
  value: string | undefined;
  required?: boolean;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = fieldId(field);
  return (
    <fieldset
      id={id}
      role="radiogroup"
      className="site-fieldset"
      aria-required={required || undefined}
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend lang={legendLang} className="site-legend">
        {legend}
      </legend>
      <div className="site-choice-stack">
        {options.map((option) => (
          <label key={option.value} className="site-choice">
            <input
              type="radio"
              name={field}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <div aria-live="polite">
        {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
      </div>
    </fieldset>
  );
}

function HealthFields({
  prefix,
  name,
  labels,
  diet,
  allergies,
  errors,
  onDiet,
  onAllergies,
  saved = false,
  savedName,
}: {
  prefix: string;
  name: string;
  labels: RsvpLabels;
  diet: string;
  allergies: string;
  errors: FieldErrors;
  onDiet: (value: string) => void;
  onAllergies: (value: string) => void;
  /** Dřívější odpověď má uložené údaje, které se hostovi z ochrany soukromí nezobrazují. */
  saved?: boolean;
  /** Jméno z dřívější odpovědi (doprovod, dítě): podle něj se uložené údaje najdou i po přejmenování. */
  savedName?: string;
}) {
  const dietField = `${prefix}.diet`;
  const allergiesField = `${prefix}.allergies`;
  return (
    <fieldset className="site-fieldset site-health">
      <legend className="site-legend">{fill(labels.health.legend, { name })}</legend>
      <p className="site-muted site-hint">{labels.health.notice}</p>
      {saved ? (
        <>
          <input type="hidden" name={`${prefix}.savedHealth`} value="1" />
          {savedName ? (
            <input type="hidden" name={`${prefix}.savedName`} value={savedName} />
          ) : null}
          <p className="site-muted site-hint">{labels.health.saved}</p>
        </>
      ) : null}
      <TextField
        field={dietField}
        label={labels.health.diet}
        hint={labels.health.dietHint}
        value={diet}
        autoComplete="off"
        maxLength={1000}
        error={errors[dietField] ? errorText(dietField, errors[dietField], labels) : undefined}
        onChange={onDiet}
      />
      <TextField
        field={allergiesField}
        label={labels.health.allergies}
        value={allergies}
        autoComplete="off"
        maxLength={1000}
        error={
          errors[allergiesField]
            ? errorText(allergiesField, errors[allergiesField], labels)
            : undefined
        }
        onChange={onAllergies}
      />
      {saved ? (
        <label className="site-choice">
          <input type="checkbox" name={`${prefix}.clearHealth`} value="1" />
          <span>{labels.health.clear}</span>
        </label>
      ) : null}
    </fieldset>
  );
}
