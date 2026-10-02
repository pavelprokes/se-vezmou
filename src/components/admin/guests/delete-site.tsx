"use client";

import { TriangleAlert } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import type { DeleteSiteAction } from "@/admin/access/action-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Icon } from "@/components/ui/icon";
import { useAdminT, type AdminKey } from "../i18n";
import { go } from "./navigate";
import { StatusMessage } from "./status";

/**
 * Smazání webu (FR-LC-1): web zmizí hned, údaje se trvale smažou po ochranné lhůtě (do té doby ho na
 * žádost obnoví provozovatel). Je to nevratné pro pár, proto výslovné potvrzení napsaným slovem
 * (ne jen klik) a vysvětlení, co se stane; kdo si jen chce data odnést, má nad tím export.
 */
export function DeleteSite({
  graceDays,
  redirectHref,
  remove,
}: {
  graceDays: number;
  redirectHref: string;
  remove: DeleteSiteAction;
}) {
  const t = useAdminT();
  const id = useId();
  const [word, setWord] = useState("");
  const [error, setError] = useState<AdminKey | null>(null);
  const [fieldError, setFieldError] = useState<AdminKey | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldError(null);
    const typed = word.trim().toLowerCase();
    if (typed !== t("admin.guests.data.delete.word").toLowerCase()) {
      setFieldError("admin.guests.data.delete.error.word");
      document.getElementById(`${id}-word`)?.focus();
      return;
    }
    setState("busy");
    const result = await remove(word);
    if (result.status === "deleted" || result.status === "not_found") {
      setState("done");
      go(redirectHref);
      return;
    }
    setState("idle");
    setError(
      result.status === "confirm_required"
        ? "admin.guests.data.delete.error.word"
        : result.status === "limited"
          ? "admin.guests.error.limited"
          : result.status === "unauthorized"
            ? "admin.guests.error.unauthorized"
            : "admin.guests.error.generic",
    );
  };

  return (
    <Card as="section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-2xl font-medium">
        {t("admin.guests.data.delete.title")}
      </h2>
      <p className="text-cinnamon-deep mt-3 flex items-start gap-2 font-medium">
        <Icon icon={TriangleAlert} className="mt-0.5" />
        <span>{t("admin.guests.data.delete.warning")}</span>
      </p>
      <ul className="mt-3 flex max-w-prose list-disc flex-col gap-1 pl-6">
        <li>{t("admin.guests.data.delete.what1")}</li>
        <li>{t("admin.guests.data.delete.what2", { days: graceDays })}</li>
        <li>{t("admin.guests.data.delete.what3")}</li>
      </ul>
      <form onSubmit={submit} noValidate className="mt-5 flex flex-col gap-3">
        <Field
          id={`${id}-word`}
          label={t("admin.guests.data.delete.confirmLabel", {
            word: t("admin.guests.data.delete.word"),
          })}
          autoComplete="off"
          value={word}
          error={fieldError ? t(fieldError) : undefined}
          onChange={(event) => setWord(event.target.value)}
        />
        <FormAlert>{error ? t(error) : null}</FormAlert>
        <StatusMessage state={state}>{t("admin.guests.data.delete.deleting")}</StatusMessage>
        <div>
          <Button type="submit" variant="secondary" disabled={state === "busy"}>
            {t("admin.guests.data.delete.submit")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
