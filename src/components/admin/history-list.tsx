"use client";

import { CircleAlert, CircleCheck, History, Save } from "lucide-react";
import { useState } from "react";
import type { RestoreActionResult } from "@/admin/site/action-types";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { ConfirmButton } from "./confirm-button";
import { useAdminT } from "./i18n";

export interface HistoryItem {
  id: string;
  versionNo: number;
  kind: "publish" | "checkpoint";
  note: string | null;
  /** Čas už naformátovaný serverem v pásmu svatby (bez rozdílu mezi serverem a prohlížečem). */
  when: string;
  isPublished: boolean;
  byMe: boolean;
}

/**
 * Historie verzí (FR-ADM-2): zveřejněné verze a body pro vrácení. Vrácení načte snímek do konceptu
 * (současný koncept se před tím uloží jako bod pro vrácení); zveřejnit ho je výslovný další krok.
 */
export function HistoryList({
  items,
  editorHref,
  restore,
}: {
  items: HistoryItem[];
  editorHref: string;
  restore: (versionId: string) => Promise<RestoreActionResult>;
}) {
  const t = useAdminT();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(item: HistoryItem) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await restore(item.id);
      if (result.status === "restored") {
        setMessage({ kind: "ok", text: t("admin.history.restored", { version: item.versionNo }) });
      } else if (result.status === "not_found") {
        setMessage({ kind: "error", text: t("admin.history.error.notFound") });
      } else if (result.status === "conflict") {
        setMessage({ kind: "error", text: t("admin.history.error.conflict") });
      } else if (result.status === "limited") {
        setMessage({ kind: "error", text: t("admin.error.limited") });
      } else if (result.status === "unauthorized") {
        setMessage({ kind: "error", text: t("admin.error.unauthorized") });
      } else {
        setMessage({ kind: "error", text: t("admin.history.error.generic") });
      }
    } catch {
      setMessage({ kind: "error", text: t("admin.history.error.generic") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="status" aria-live="polite" className="flex flex-col gap-3">
        {message ? (
          <>
            <p
              className={
                message.kind === "ok"
                  ? "text-pine flex items-start gap-2 font-medium"
                  : "text-cinnamon-deep flex items-start gap-2 font-medium"
              }
              data-testid="history-result"
            >
              <Icon icon={message.kind === "ok" ? CircleCheck : CircleAlert} className="mt-1" />
              <span>{message.text}</span>
            </p>
            {message.kind === "ok" ? (
              <p>
                <a href={editorHref} className={buttonVariants()}>
                  {t("admin.history.restoredNext")}
                </a>
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="text-muted">{t("admin.history.empty")}</p>
      ) : (
        <ol aria-label={t("admin.history.list")} className="flex flex-col gap-3">
          {items.map((item) => (
            <li
              key={item.id}
              data-testid={`version-${item.versionNo}`}
              className="border-hairline bg-parchment flex flex-col gap-2 rounded-2xl border p-4"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="text-ink font-sans text-lg font-semibold">
                  {t("admin.history.version", { version: item.versionNo })}
                </h2>
                <span className="text-muted flex items-center gap-1">
                  <Icon icon={item.kind === "publish" ? History : Save} size={18} />
                  {item.kind === "publish"
                    ? t("admin.history.kind.publish")
                    : t("admin.history.kind.checkpoint")}
                </span>
                {item.isPublished ? (
                  <span className="text-pine flex items-center gap-1 font-medium">
                    <Icon icon={CircleCheck} size={18} />
                    {t("admin.history.current")}
                  </span>
                ) : null}
                {item.byMe ? (
                  <span className="text-muted text-sm">{t("admin.history.byMe")}</span>
                ) : null}
              </div>
              <p className="text-muted">{item.when}</p>
              <p>{item.note ?? t("admin.history.noNote")}</p>
              {!item.isPublished ? (
                <div>
                  <ConfirmButton
                    label={t("admin.history.restore")}
                    ariaLabel={t("admin.history.restoreLabel", { version: item.versionNo })}
                    question={t("admin.history.restoreQuestion", { version: item.versionNo })}
                    confirmLabel={t("admin.history.restoreConfirm")}
                    disabled={busy}
                    onConfirm={() => void run(item)}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
