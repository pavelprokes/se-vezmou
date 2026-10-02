"use client";

import { CircleCheck, CircleAlert } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { QuickNoticeActionResult } from "@/admin/site/action-types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/i18n/config";
import type { I18nText } from "@/site/i18n-text";
import { LocalizedField } from "./fields";
import { useAdminT } from "./i18n";

/**
 * Rychlá změna (FR-ADM-3): pruh nahoře na webu pro vzkaz hostům („Změna: obřad začíná v 15:00“).
 * Platí hned po uložení, bez nové publikace; vypnutí pruh skryje a text zůstane uložený.
 */
export function QuickNotice({
  initial,
  locales,
  action,
  published,
  onSaved,
}: {
  initial: { notice: I18nText | null; enabled: boolean };
  locales: readonly Locale[];
  action: (input: unknown) => Promise<QuickNoticeActionResult>;
  published: boolean;
  onSaved?: (value: { notice: I18nText | null; enabled: boolean }) => void;
}) {
  const t = useAdminT();
  const [notice, setNotice] = useState<I18nText | null>(initial.notice);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "empty" | "error">("idle");

  const hasText = locales.some((locale) => notice?.[locale]?.trim());

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (enabled && !hasText) {
      setState("empty");
      return;
    }
    setState("saving");
    const result = await action({ notice: notice ?? {}, enabled });
    if (result.status === "ok") {
      setState("saved");
      onSaved?.({ notice, enabled });
    } else {
      setState(result.status === "empty" ? "empty" : "error");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <LocalizedField
        label={t("admin.quick.text")}
        hint={t("admin.quick.hint")}
        multiline
        rows={2}
        maxLength={500}
        locales={locales}
        value={notice}
        onChange={(next) => {
          setNotice(next);
          setState("idle");
        }}
      />
      <Checkbox
        label={t("admin.quick.enabled")}
        checked={enabled}
        onChange={(event) => {
          setEnabled(event.target.checked);
          setState("idle");
        }}
      />
      {!published ? <p className="text-muted text-sm">{t("admin.quick.notPublished")}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={state === "saving"}>
          {state === "saving" ? t("admin.common.saving") : t("admin.quick.save")}
        </Button>
        <div role="status" aria-live="polite">
          {state === "saved" ? (
            <p className="text-pine flex items-center gap-2 font-medium">
              <Icon icon={CircleCheck} />
              {enabled ? t("admin.quick.savedOn") : t("admin.quick.savedOff")}
            </p>
          ) : null}
          {state === "empty" ? (
            <p className="text-cinnamon-deep flex items-center gap-2 font-medium">
              <Icon icon={CircleAlert} />
              {t("admin.quick.empty")}
            </p>
          ) : null}
          {state === "error" ? (
            <p className="text-cinnamon-deep flex items-center gap-2 font-medium">
              <Icon icon={CircleAlert} />
              {t("admin.quick.error")}
            </p>
          ) : null}
        </div>
      </div>
    </form>
  );
}
