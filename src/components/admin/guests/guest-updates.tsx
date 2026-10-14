"use client";

import { Send } from "lucide-react";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import type { GuestUpdateResult } from "@/admin/guests/updates";
import type { Guarded } from "@/admin/site/action-types";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Icon } from "@/components/ui/icon";
import { TextArea } from "@/components/ui/textarea";
import type { Locale } from "@/i18n/config";
import { useAdminT, type AdminKey } from "../i18n";
import { StatusMessage } from "./status";

const MAX = 1000;

const LANGUAGE: Record<Locale, AdminKey> = {
  cs: "admin.guests.responses.updates.langCs",
  en: "admin.guests.responses.updates.langEn",
};

/**
 * Formulář upozornění hostům na změnu (přehled odpovědí). Pole na text v každém jazyce webu (hlavní
 * povinné, ostatní nepovinné); výsledek slovy v živé oblasti, chyba celého formuláře v `FormAlert`.
 */
export function GuestUpdates({
  locales,
  count,
  action,
}: {
  /** Jazyky webu, hlavní první. */
  locales: Locale[];
  count: number;
  action: (input: unknown) => Promise<Guarded<GuestUpdateResult>>;
}) {
  const t = useAdminT();
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<AdminKey | null>(null);
  const [sent, setSent] = useState<number | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const input = Object.fromEntries(
      locales.map((locale) => [locale, String(data.get(`text-${locale}`) ?? "")]),
    );
    if (String(input[locales[0]] ?? "").trim() === "") {
      setSent(null);
      setError("admin.guests.responses.updates.empty");
      document.getElementById(`${id}-text-${locales[0]}`)?.focus();
      return;
    }
    setError(null);
    setSent(null);
    startTransition(async () => {
      const result = await action(input);
      switch (result.status) {
        case "sent":
          setSent(result.count);
          formRef.current?.reset();
          return;
        case "empty":
          setError("admin.guests.responses.updates.empty");
          return;
        case "too_long":
          setError("admin.guests.responses.updates.tooLong");
          return;
        case "nobody":
          setError("admin.guests.responses.updates.nobody");
          return;
        case "limited":
          setError("admin.guests.responses.updates.limited");
          return;
        case "unauthorized":
          setError("admin.guests.error.unauthorized");
          return;
        default:
          setError("admin.guests.responses.updates.failed");
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="mt-4 flex flex-col gap-4">
      <h3 className="text-xl font-medium">{t("admin.guests.responses.updates.compose")}</h3>
      <p className="text-muted max-w-prose">{t("admin.guests.responses.updates.composeIntro")}</p>
      {locales.map((locale, index) => (
        <TextArea
          key={locale}
          id={`${id}-text-${locale}`}
          name={`text-${locale}`}
          label={t("admin.guests.responses.updates.text", { lang: t(LANGUAGE[locale]) })}
          hint={
            index === 0
              ? t("admin.guests.responses.updates.textHint")
              : t("admin.guests.responses.updates.textOptional")
          }
          lang={locale}
          rows={4}
          maxLength={MAX}
          required={index === 0}
          aria-required={index === 0 || undefined}
        />
      ))}
      <FormAlert>{error ? t(error) : null}</FormAlert>
      <StatusMessage state={pending ? "busy" : sent !== null ? "done" : "idle"}>
        {pending
          ? t("admin.guests.responses.updates.sending")
          : sent !== null
            ? t("admin.guests.responses.updates.sent", { n: sent })
            : null}
      </StatusMessage>
      <div>
        <Button type="submit" disabled={pending || count === 0}>
          <Icon icon={Send} size={18} />
          {t("admin.guests.responses.updates.send")}
        </Button>
      </div>
    </form>
  );
}
