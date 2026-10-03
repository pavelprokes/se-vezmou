"use client";

import { CircleCheck, CircleX, Eye, ShieldCheck, UserMinus } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { AccessActions } from "@/admin/access/action-types";
import { GRANT_DAYS, GRANT_REASON, type AccessView } from "@/admin/access/types";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Icon } from "@/components/ui/icon";
import { TextArea } from "@/components/ui/textarea";
import { intlLocale, type Locale } from "@/i18n/config";
import { ConfirmButton } from "../confirm-button";
import { useAdminT, type AdminKey } from "../i18n";
import { go } from "./navigate";
import { StatusMessage } from "./status";

function formatMoment(iso: string, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(intlLocale[locale], {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

type Busy = "idle" | "busy" | "done";

/** Dvoukrokové potvrzení pod polem: první krok ukáže otázku, druhý akci provede. */
function Confirm({
  question,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useAdminT();
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => confirm.current?.focus(), []);
  return (
    <div
      role="group"
      aria-label={question}
      className="border-hairline bg-parchment flex flex-col gap-2 rounded-2xl border p-3"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <p className="text-ink font-medium">{question}</p>
      <div className="flex flex-wrap gap-2">
        <button ref={confirm} type="button" className={buttonVariants()} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("admin.common.cancel")}
        </Button>
      </div>
    </div>
  );
}

const SIMPLE_ERRORS: Record<string, AdminKey> = {
  limited: "admin.guests.error.limited",
  unauthorized: "admin.guests.error.unauthorized",
  error: "admin.guests.error.generic",
};

function simpleError(status: string): AdminKey {
  return SIMPLE_ERRORS[status] ?? "admin.guests.error.generic";
}

// --- správci --------------------------------------------------------------------------------

export function AdminsPanel({
  view,
  locale,
  actions,
}: {
  view: AccessView;
  locale: Locale;
  actions: Pick<AccessActions, "addAdmin" | "removeAdmin">;
}) {
  const t = useAdminT();
  const id = useId();
  const [email, setEmail] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<AdminKey | null>(null);
  const [fieldError, setFieldError] = useState<AdminKey | null>(null);
  const [state, setState] = useState<Busy>("idle");
  const [message, setMessage] = useState("");
  const full = view.admins.length >= view.max_admins;

  const ask = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setFieldError("admin.guests.access.admins.error.email");
      document.getElementById(`${id}-email`)?.focus();
      return;
    }
    setConfirming(true);
  };

  const add = async () => {
    setConfirming(false);
    setState("busy");
    setMessage(t("admin.common.saving"));
    const result = await actions.addAdmin(email.trim());
    if (result.status === "added") {
      setState("done");
      setMessage(t("admin.guests.access.admins.added"));
      go(`${window.location.pathname}?ulozeno=admin`);
      return;
    }
    setState("idle");
    if (result.status === "invalid") setFieldError("admin.guests.access.admins.error.email");
    else if (result.status === "exists") setFieldError("admin.guests.access.admins.error.exists");
    else if (result.status === "full") setError("admin.guests.access.admins.error.full");
    else setError(simpleError(result.status));
  };

  const remove = async (adminId: string) => {
    setError(null);
    setState("busy");
    setMessage(t("admin.common.saving"));
    const result = await actions.removeAdmin(adminId);
    if (result.status === "removed" || result.status === "not_found") {
      go(`${window.location.pathname}?ulozeno=admin`);
      return;
    }
    setState("idle");
    setError(
      result.status === "self"
        ? "admin.guests.access.admins.error.self"
        : simpleError(result.status),
    );
  };

  return (
    <Card as="section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-2xl font-medium">
        {t("admin.guests.access.admins.title")}
      </h2>
      <p className="text-muted mt-2 max-w-prose">{t("admin.guests.access.admins.intro")}</p>
      <p className="mt-3 font-medium" data-testid="admins-count">
        {t("admin.guests.access.admins.count", { n: view.admins.length, max: view.max_admins })}
      </p>
      <ul className="mt-3 flex flex-col gap-3" aria-label={t("admin.guests.access.admins.title")}>
        {view.admins.map((admin) => (
          <li
            key={admin.id}
            className="border-hairline bg-parchment flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4"
          >
            <div>
              <p className="text-ink font-medium">
                {admin.email}
                {admin.is_me ? (
                  <span className="text-muted font-normal">
                    {" "}
                    ({t("admin.guests.access.admins.me")})
                  </span>
                ) : null}
              </p>
              <p className="text-muted text-sm">
                {admin.last_login_at
                  ? t("admin.guests.access.admins.lastLogin", {
                      when: formatMoment(admin.last_login_at, locale, view.timezone),
                    })
                  : t("admin.guests.access.admins.neverLoggedIn")}
              </p>
            </div>
            {admin.is_me ? null : (
              <ConfirmButton
                variant="text"
                label={
                  <>
                    <Icon icon={UserMinus} size={18} />
                    {t("admin.guests.access.admins.remove")}
                  </>
                }
                ariaLabel={t("admin.guests.access.admins.removeLabel", { email: admin.email })}
                question={t("admin.guests.access.admins.removeQuestion", { email: admin.email })}
                confirmLabel={t("admin.guests.access.admins.removeConfirm")}
                disabled={state === "busy"}
                onConfirm={() => remove(admin.id)}
              />
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={ask} noValidate className="mt-5 flex flex-col gap-3">
        <h3 className="text-xl font-medium">{t("admin.guests.access.admins.addTitle")}</h3>
        <Field
          id={`${id}-email`}
          label={t("admin.guests.access.admins.email")}
          hint={t("admin.guests.access.admins.emailHint")}
          type="email"
          autoComplete="off"
          value={email}
          disabled={full}
          error={fieldError ? t(fieldError) : undefined}
          onChange={(event) => {
            setEmail(event.target.value);
            setConfirming(false);
          }}
        />
        {full ? <p className="text-muted">{t("admin.guests.access.admins.fullNote")}</p> : null}
        {confirming ? (
          <Confirm
            question={t("admin.guests.access.admins.addQuestion", { email: email.trim() })}
            confirmLabel={t("admin.guests.access.admins.addConfirm")}
            onConfirm={add}
            onCancel={() => setConfirming(false)}
          />
        ) : (
          <div>
            <Button type="submit" disabled={full || state === "busy"}>
              {t("admin.guests.access.admins.add")}
            </Button>
          </div>
        )}
        <FormAlert>{error ? t(error) : null}</FormAlert>
        <StatusMessage state={state}>{message}</StatusMessage>
      </form>
    </Card>
  );
}

// --- záložní e-mail -------------------------------------------------------------------------

export function BackupPanel({
  view,
  actions,
}: {
  view: AccessView;
  actions: Pick<AccessActions, "setBackupEmail">;
}) {
  const t = useAdminT();
  const id = useId();
  const [email, setEmail] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [fieldError, setFieldError] = useState<AdminKey | null>(null);
  const [error, setError] = useState<AdminKey | null>(null);
  const [state, setState] = useState<Busy>("idle");
  const [message, setMessage] = useState("");

  const ask = (event: FormEvent) => {
    event.preventDefault();
    setFieldError(null);
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setFieldError("admin.guests.access.admins.error.email");
      document.getElementById(`${id}-email`)?.focus();
      return;
    }
    setConfirming(true);
  };

  const change = async () => {
    setConfirming(false);
    setState("busy");
    setMessage(t("admin.common.saving"));
    const result = await actions.setBackupEmail(email.trim());
    if (result.status === "changed" || result.status === "same") {
      go(`${window.location.pathname}?ulozeno=zaloha`);
      return;
    }
    setState("idle");
    if (result.status === "invalid") setFieldError("admin.guests.access.admins.error.email");
    else setError(simpleError(result.status));
  };

  return (
    <Card as="section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-2xl font-medium">
        {t("admin.guests.access.backup.title")}
      </h2>
      <p className="text-muted mt-2 max-w-prose">{t("admin.guests.access.backup.intro")}</p>
      <p className="mt-3 font-medium" data-testid="backup-email">
        {t("admin.guests.access.backup.current", { email: view.backup_email ?? "–" })}
      </p>
      {view.backup_email && !view.backup_confirmed ? (
        <p className="text-muted mt-1 max-w-prose" data-testid="backup-unconfirmed">
          {t("admin.guests.access.backup.unconfirmed")}
        </p>
      ) : null}
      <form onSubmit={ask} noValidate className="mt-4 flex flex-col gap-3">
        <Field
          id={`${id}-email`}
          label={t("admin.guests.access.backup.new")}
          type="email"
          autoComplete="off"
          value={email}
          error={fieldError ? t(fieldError) : undefined}
          onChange={(event) => {
            setEmail(event.target.value);
            setConfirming(false);
          }}
        />
        {confirming ? (
          <Confirm
            question={t("admin.guests.access.backup.question", { email: email.trim() })}
            confirmLabel={t("admin.guests.access.backup.confirm")}
            onConfirm={change}
            onCancel={() => setConfirming(false)}
          />
        ) : (
          <div>
            <Button type="submit" variant="secondary" disabled={state === "busy"}>
              {t("admin.guests.access.backup.submit")}
            </Button>
          </div>
        )}
        <FormAlert>{error ? t(error) : null}</FormAlert>
        <StatusMessage state={state}>{message}</StatusMessage>
      </form>
    </Card>
  );
}

// --- PIN ------------------------------------------------------------------------------------

const PIN_PROBLEM: Record<string, AdminKey> = {
  format: "admin.guests.access.pin.error.format",
  trivial: "admin.guests.access.pin.error.trivial",
  same_as_other: "admin.guests.access.pin.error.same",
};

function PinForm({
  role,
  has,
  change,
}: {
  role: "admin" | "guest";
  has: boolean;
  change: AccessActions["changePin"];
}) {
  const t = useAdminT();
  const id = useId();
  const [pin, setPin] = useState("");
  const [fieldError, setFieldError] = useState<AdminKey | null>(null);
  const [error, setError] = useState<AdminKey | null>(null);
  const [state, setState] = useState<Busy>("idle");
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFieldError(null);
    setError(null);
    setState("busy");
    setMessage(t("admin.common.saving"));
    const result = await change(role, pin);
    if (result.status === "ok") {
      setPin("");
      setState("done");
      setMessage(t("admin.guests.access.pin.saved"));
      return;
    }
    setState("idle");
    if (result.status === "invalid") {
      setFieldError(PIN_PROBLEM[result.problem] ?? "admin.guests.access.pin.error.format");
      document.getElementById(`${id}-pin`)?.focus();
    } else {
      setError(simpleError(result.status));
    }
  };

  const copy: { title: AdminKey; intro: AdminKey } =
    role === "admin"
      ? {
          title: "admin.guests.access.pin.admin.title",
          intro: "admin.guests.access.pin.admin.intro",
        }
      : {
          title: "admin.guests.access.pin.guest.title",
          intro: "admin.guests.access.pin.guest.intro",
        };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <h3 className="text-xl font-medium">{t(copy.title)}</h3>
      <p className="text-muted max-w-prose">{t(copy.intro)}</p>
      <p className="font-medium">
        {has ? t("admin.guests.access.pin.isSet") : t("admin.guests.access.pin.isNotSet")}
      </p>
      <Field
        id={`${id}-pin`}
        label={has ? t("admin.guests.access.pin.newLabel") : t("admin.guests.access.pin.setLabel")}
        hint={t("admin.guests.access.pin.hint")}
        type={role === "admin" ? "password" : "text"}
        inputMode="numeric"
        autoComplete="new-password"
        value={pin}
        maxLength={16}
        error={fieldError ? t(fieldError) : undefined}
        onChange={(event) => setPin(event.target.value)}
      />
      <FormAlert>{error ? t(error) : null}</FormAlert>
      <StatusMessage state={state}>{message}</StatusMessage>
      <div>
        <Button type="submit" variant="secondary" disabled={state === "busy" || pin.trim() === ""}>
          {has ? t("admin.guests.access.pin.change") : t("admin.guests.access.pin.set")}
        </Button>
      </div>
    </form>
  );
}

export function PinPanel({
  view,
  actions,
}: {
  view: AccessView;
  actions: Pick<AccessActions, "changePin" | "setGuestPinEnabled">;
}) {
  const t = useAdminT();
  const id = useId();
  const [enabled, setEnabled] = useState(view.guest_pin_enabled);
  const [error, setError] = useState<AdminKey | null>(null);
  const [state, setState] = useState<Busy>("idle");
  const [message, setMessage] = useState("");

  const toggle = async (next: boolean) => {
    setError(null);
    setState("busy");
    setMessage(t("admin.common.saving"));
    const result = await actions.setGuestPinEnabled(next);
    if (result.status === "ok") {
      setEnabled(next);
      setState("done");
      setMessage(
        next ? t("admin.guests.access.pin.enabledNow") : t("admin.guests.access.pin.disabledNow"),
      );
      return;
    }
    setState("idle");
    setError(
      result.status === "pin_missing"
        ? "admin.guests.access.pin.error.missing"
        : simpleError(result.status),
    );
  };

  return (
    <Card as="section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-2xl font-medium">
        {t("admin.guests.access.pin.title")}
      </h2>
      <p className="text-muted mt-2 max-w-prose">{t("admin.guests.access.pin.intro")}</p>
      <div className="mt-5 flex flex-col gap-8">
        <PinForm role="admin" has={view.has_admin_pin} change={actions.changePin} />
        <PinForm role="guest" has={view.has_guest_pin} change={actions.changePin} />
        <div className="flex flex-col gap-3">
          <h3 className="text-xl font-medium">{t("admin.guests.access.pin.toggle.title")}</h3>
          <p className="flex items-center gap-2 font-medium" data-testid="guest-pin-state">
            <Icon icon={enabled ? CircleCheck : CircleX} />
            {enabled
              ? t("admin.guests.access.pin.toggle.on")
              : t("admin.guests.access.pin.toggle.off")}
          </p>
          <p className="text-muted max-w-prose">{t("admin.guests.access.pin.toggle.intro")}</p>
          <div>
            {enabled ? (
              <ConfirmButton
                label={t("admin.guests.access.pin.toggle.turnOff")}
                question={t("admin.guests.access.pin.toggle.offQuestion")}
                confirmLabel={t("admin.guests.access.pin.toggle.offConfirm")}
                disabled={state === "busy"}
                onConfirm={() => toggle(false)}
              />
            ) : (
              <Button
                type="button"
                variant="secondary"
                disabled={state === "busy"}
                onClick={() => toggle(true)}
              >
                {t("admin.guests.access.pin.toggle.turnOn")}
              </Button>
            )}
          </div>
          <FormAlert>{error ? t(error) : null}</FormAlert>
          <StatusMessage state={state}>{message}</StatusMessage>
        </div>
      </div>
    </Card>
  );
}

// --- souhlas s nahlédnutím provozovatele ----------------------------------------------------

export function ConsentPanel({
  view,
  locale,
  actions,
}: {
  view: AccessView;
  locale: Locale;
  actions: Pick<AccessActions, "grant" | "revoke">;
}) {
  const t = useAdminT();
  const id = useId();
  const [reason, setReason] = useState("");
  const [days, setDays] = useState<number>(7);
  const [confirming, setConfirming] = useState(false);
  const [fieldError, setFieldError] = useState<AdminKey | null>(null);
  const [error, setError] = useState<AdminKey | null>(null);
  const [state, setState] = useState<Busy>("idle");
  const [message, setMessage] = useState("");
  const active = view.grants.find((grant) => grant.active);

  const ask = (event: FormEvent) => {
    event.preventDefault();
    setFieldError(null);
    setError(null);
    if (reason.trim().length < GRANT_REASON.min) {
      setFieldError("admin.guests.access.consent.error.reason");
      document.getElementById(`${id}-reason`)?.focus();
      return;
    }
    setConfirming(true);
  };

  const grant = async () => {
    setConfirming(false);
    setState("busy");
    setMessage(t("admin.common.saving"));
    const result = await actions.grant({ reason: reason.trim(), days });
    if (result.status === "granted") {
      go(`${window.location.pathname}?ulozeno=souhlas`);
      return;
    }
    setState("idle");
    if (result.status === "invalid") setFieldError("admin.guests.access.consent.error.reason");
    else setError(simpleError(result.status));
  };

  const revoke = async (grantId: string) => {
    setError(null);
    setState("busy");
    setMessage(t("admin.common.saving"));
    const result = await actions.revoke(grantId);
    if (result.status === "revoked" || result.status === "not_found") {
      go(`${window.location.pathname}?ulozeno=souhlas`);
      return;
    }
    setState("idle");
    setError(simpleError(result.status));
  };

  const past = view.grants.filter((grant) => !grant.active);

  return (
    <Card as="section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-2xl font-medium">
        {t("admin.guests.access.consent.title")}
      </h2>
      <p className="text-muted mt-2 max-w-prose">{t("admin.guests.access.consent.intro")}</p>

      <div className="mt-4" data-testid="consent-state">
        {active ? (
          <div className="border-hairline bg-parchment flex flex-col gap-2 rounded-2xl border p-4">
            <p className="flex items-center gap-2 font-medium">
              <Icon icon={ShieldCheck} />
              {t("admin.guests.access.consent.active", {
                until: formatMoment(active.expires_at, locale, view.timezone),
              })}
            </p>
            <p className="text-muted">
              {t("admin.guests.access.consent.reason", { reason: active.reason })}
            </p>
            <div>
              <ConfirmButton
                label={t("admin.guests.access.consent.revoke")}
                question={t("admin.guests.access.consent.revokeQuestion")}
                confirmLabel={t("admin.guests.access.consent.revokeConfirm")}
                disabled={state === "busy"}
                onConfirm={() => revoke(active.id)}
              />
            </div>
          </div>
        ) : (
          <p className="flex items-center gap-2 font-medium">
            <Icon icon={CircleX} />
            {t("admin.guests.access.consent.none")}
          </p>
        )}
      </div>

      <form onSubmit={ask} noValidate className="mt-5 flex flex-col gap-3">
        <h3 className="text-xl font-medium">{t("admin.guests.access.consent.grantTitle")}</h3>
        <TextArea
          id={`${id}-reason`}
          label={t("admin.guests.access.consent.reasonLabel")}
          hint={t("admin.guests.access.consent.reasonHint")}
          rows={3}
          maxLength={GRANT_REASON.max}
          value={reason}
          error={fieldError ? t(fieldError) : undefined}
          onChange={(event) => {
            setReason(event.target.value);
            setConfirming(false);
          }}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-days`} className="text-ink font-medium">
            {t("admin.guests.access.consent.days")}
          </label>
          <select
            id={`${id}-days`}
            className="min-h-target rounded-button bg-parchment text-ink border-field-border w-full max-w-60 border-2 px-3 py-2 text-base"
            value={days}
            onChange={(event) => {
              setDays(Number(event.target.value));
              setConfirming(false);
            }}
          >
            {GRANT_DAYS.map((value) => (
              <option key={value} value={value}>
                {t("admin.guests.access.consent.daysOption", { n: value })}
              </option>
            ))}
          </select>
        </div>
        {confirming ? (
          <Confirm
            question={t("admin.guests.access.consent.grantQuestion", { n: days })}
            confirmLabel={t("admin.guests.access.consent.grantConfirm")}
            onConfirm={grant}
            onCancel={() => setConfirming(false)}
          />
        ) : (
          <div>
            <Button type="submit" variant="secondary" disabled={state === "busy"}>
              {active
                ? t("admin.guests.access.consent.replace")
                : t("admin.guests.access.consent.grant")}
            </Button>
          </div>
        )}
        <FormAlert>{error ? t(error) : null}</FormAlert>
        <StatusMessage state={state}>{message}</StatusMessage>
      </form>

      <div className="mt-6">
        <h3 className="flex items-center gap-2 text-xl font-medium">
          <Icon icon={Eye} />
          {t("admin.guests.access.consent.viewsTitle")}
        </h3>
        {view.operator_views.length === 0 ? (
          <p className="text-muted mt-2">{t("admin.guests.access.consent.noViews")}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2" data-testid="operator-views">
            {view.operator_views.map((entry) => (
              <li key={entry.id}>
                <span className="font-medium">{formatMoment(entry.at, locale, view.timezone)}</span>
                {": "}
                {entry.action === "guest_data.view"
                  ? t("admin.guests.access.consent.viewed")
                  : t("admin.guests.access.consent.denied")}
                {entry.reason
                  ? ` (${t("admin.guests.access.consent.viewReason", { reason: entry.reason })})`
                  : ""}
              </li>
            ))}
          </ul>
        )}
        {past.length > 0 ? (
          <>
            <h3 className="mt-5 text-xl font-medium">
              {t("admin.guests.access.consent.pastTitle")}
            </h3>
            <ul className="text-muted mt-2 flex flex-col gap-1">
              {past.map((entry) => (
                <li key={entry.id}>
                  {t("admin.guests.access.consent.pastItem", {
                    from: formatMoment(entry.created_at, locale, view.timezone),
                    state: entry.revoked_at
                      ? t("admin.guests.access.consent.pastRevoked")
                      : t("admin.guests.access.consent.pastExpired"),
                  })}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </Card>
  );
}
