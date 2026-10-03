"use client";

import { CircleAlert, CircleCheck, Copy, FileSpreadsheet } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { newNonce } from "@/lib/nonce";
import type { CommitImportAction } from "@/admin/guests/action-types";
import {
  IMPORT_LIMITS,
  totals,
  type PreviewRow,
  type RowProblem,
} from "@/admin/guests/import-parse";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/choice";
import { Fieldset } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Icon } from "@/components/ui/icon";
import { useAdminT, type AdminKey } from "../i18n";
import { StatusMessage } from "./status";
import type { EventOption } from "./household-editor";

type PreviewResponse =
  | { status: "ok"; rows: PreviewRow[] }
  | { status: "failed"; reason: string }
  | { status: "limited"; retryAfter: number }
  | { status: "error" | "unauthorized" };

const PROBLEM_KEY: Record<RowProblem, AdminKey> = {
  name_missing: "admin.guests.import.problem.name_missing",
  name_too_long: "admin.guests.import.problem.name_too_long",
  household_too_long: "admin.guests.import.problem.household_too_long",
  age_invalid: "admin.guests.import.problem.age_invalid",
  child_invalid: "admin.guests.import.problem.child_invalid",
  household_too_big: "admin.guests.import.problem.household_too_big",
};

const FAIL_KEY: Record<string, AdminKey> = {
  too_large: "admin.guests.import.fail.too_large",
  unsupported_format: "admin.guests.import.fail.unsupported_format",
  unreadable: "admin.guests.import.fail.unreadable",
  unpacked_too_large: "admin.guests.import.fail.unpacked_too_large",
  empty: "admin.guests.import.fail.empty",
  no_name_column: "admin.guests.import.fail.no_name_column",
  too_many_rows: "admin.guests.import.fail.too_many_rows",
};

/**
 * Import seznamu hostů (FR-ADM-4) ve třech krocích: výběr souboru, náhled s ověřením a upozorněním
 * na chyby a duplicity, potvrzení. Nic se nezapíše, dokud pár import nepotvrdí. Soubor jde na server
 * jen k přečtení v náhledu (neukládá se); po potvrzení server řádky ověří znovu.
 */
export function ImportFlow({
  events,
  previewUrl,
  templateUrl,
  listHref,
  commit,
}: {
  events: EventOption[];
  previewUrl: string;
  templateUrl: string;
  listHref: string;
  commit: CommitImportAction;
}) {
  const t = useAdminT();
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"choose" | "preview" | "done">("choose");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [eventIds, setEventIds] = useState<string[]>(events.map((event) => event.id));
  const [result, setResult] = useState<{ households: number; guests: number } | null>(null);
  // Idempotenční klíč dávky: dvojklik na „Importovat“ i opakování po výpadku sítě odešle týž klíč, takže se
  // hosté nezapíšou dvakrát. Nový náhled (nový soubor) dostane nový klíč.
  const nonce = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const sum = totals(rows, includeDuplicates);

  // po přechodu na další krok se zaměření přesune na jeho nadpis (čtečka ohlásí, kde je)
  useEffect(() => {
    if (step !== "choose") heading.current?.focus();
  }, [step]);

  const loadPreview = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setError(t("admin.guests.import.error.noFile"));
      fileInput.current?.focus();
      return;
    }
    if (file.size > IMPORT_LIMITS.fileBytes) {
      setError(t("admin.guests.import.fail.too_large"));
      return;
    }
    setState("busy");
    const body = new FormData();
    body.set("file", file);
    let response: PreviewResponse;
    try {
      const raw = await fetch(previewUrl, { method: "POST", body });
      response = (await raw.json()) as PreviewResponse;
    } catch {
      response = { status: "error" };
    }
    setState("idle");
    if (response.status === "ok") {
      setRows(response.rows);
      nonce.current = null;
      setStep("preview");
    } else if (response.status === "failed") {
      setError(t(FAIL_KEY[response.reason] ?? "admin.guests.import.fail.unreadable"));
    } else if (response.status === "limited") {
      setError(t("admin.guests.error.limited"));
    } else if (response.status === "unauthorized") {
      setError(t("admin.guests.error.unauthorized"));
    } else {
      setError(t("admin.guests.error.generic"));
    }
  };

  const confirm = async () => {
    setError(null);
    setState("busy");
    nonce.current ??= newNonce();
    const outcome = await commit({
      nonce: nonce.current,
      rows: rows.map((row) => ({
        line: row.line,
        household: row.household,
        name: row.name,
        isChild: row.isChild,
        age: row.age,
      })),
      includeDuplicates,
      eventIds,
    });
    if (outcome.status === "imported") {
      setResult({ households: outcome.households, guests: outcome.guests });
      setStep("done");
      setState("idle");
      return;
    }
    setState("idle");
    setError(
      outcome.status === "guest_limit"
        ? t("admin.guests.import.error.limit")
        : outcome.status === "nothing"
          ? t("admin.guests.import.error.nothing")
          : outcome.status === "limited"
            ? t("admin.guests.error.limited")
            : outcome.status === "unauthorized"
              ? t("admin.guests.error.unauthorized")
              : t("admin.guests.error.generic"),
    );
  };

  if (step === "done" && result) {
    return (
      <Card as="section" aria-labelledby={`${id}-done`}>
        <h2 id={`${id}-done`} ref={heading} tabIndex={-1} className="text-2xl font-medium">
          {t("admin.guests.import.done.title")}
        </h2>
        <p
          className="mt-3 flex items-center gap-2 text-lg"
          role="status"
          data-testid="import-result"
        >
          <Icon icon={CircleCheck} />
          {t("admin.guests.import.done.text", {
            guests: result.guests,
            households: result.households,
          })}
        </p>
        <p className="mt-4">
          <a href={listHref} className={buttonVariants()}>
            {t("admin.guests.import.done.back")}
          </a>
        </p>
      </Card>
    );
  }

  if (step === "preview") {
    return (
      <div className="flex flex-col gap-6">
        <Card as="section" aria-labelledby={`${id}-preview`}>
          <h2 id={`${id}-preview`} ref={heading} tabIndex={-1} className="text-2xl font-medium">
            {t("admin.guests.import.preview.title")}
          </h2>
          <p className="mt-3 text-lg" data-testid="import-summary">
            {t("admin.guests.import.preview.summary", {
              rows: sum.rows,
              importable: sum.importable,
              errors: sum.errors,
              duplicates: sum.duplicates,
            })}
          </p>
          {sum.errors > 0 ? (
            <p className="text-muted mt-2">{t("admin.guests.import.preview.errorsNote")}</p>
          ) : null}
          {sum.duplicates > 0 ? (
            <div className="mt-4">
              <Checkbox
                label={t("admin.guests.import.preview.duplicates")}
                checked={includeDuplicates}
                onChange={(event) => setIncludeDuplicates(event.target.checked)}
              />
            </div>
          ) : null}
        </Card>

        <div
          role="region"
          aria-label={t("admin.guests.import.preview.tableLabel")}
          tabIndex={0}
          className="border-hairline overflow-x-auto rounded-2xl border"
        >
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <caption className="sr-only">{t("admin.guests.import.preview.tableLabel")}</caption>
            <thead className="bg-linen">
              <tr>
                <th scope="col" className="px-3 py-2">
                  {t("admin.guests.import.col.line")}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t("admin.guests.import.col.household")}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t("admin.guests.import.col.name")}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t("admin.guests.import.col.child")}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t("admin.guests.import.col.status")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const skipped = row.duplicate && !includeDuplicates;
                return (
                  <tr key={row.line} className="border-hairline border-t">
                    <td className="px-3 py-2">{row.line}</td>
                    <td className="px-3 py-2">{row.household || "–"}</td>
                    <th scope="row" className="px-3 py-2 font-medium">
                      {row.name || "–"}
                    </th>
                    <td className="px-3 py-2">
                      {row.isChild
                        ? row.age !== null
                          ? t("admin.guests.list.childAge", { age: row.age })
                          : t("admin.guests.list.child")
                        : "–"}
                    </td>
                    <td className="px-3 py-2">
                      {row.problem ? (
                        <span className="text-cinnamon-deep flex items-start gap-2 font-medium">
                          <Icon icon={CircleAlert} size={18} className="mt-0.5" />
                          {t(PROBLEM_KEY[row.problem])}
                        </span>
                      ) : row.duplicate ? (
                        <span className="flex items-start gap-2">
                          <Icon icon={Copy} size={18} className="mt-0.5" />
                          {row.duplicate === "existing"
                            ? t("admin.guests.import.status.existing")
                            : t("admin.guests.import.status.file")}
                          {" – "}
                          {skipped
                            ? t("admin.guests.import.status.skipped")
                            : t("admin.guests.import.status.included")}
                        </span>
                      ) : (
                        <span className="flex items-start gap-2">
                          <Icon icon={CircleCheck} size={18} className="mt-0.5" />
                          {t("admin.guests.import.status.ready")}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Card as="section" aria-labelledby={`${id}-invite`}>
          <h2 id={`${id}-invite`} className="text-2xl font-medium">
            {t("admin.guests.import.invite.title")}
          </h2>
          <p className="text-muted mt-2">{t("admin.guests.import.invite.intro")}</p>
          <Fieldset legend={t("admin.guests.import.invite.legend")} className="mt-3">
            {events.length === 0 ? (
              <p className="text-muted">{t("admin.guests.editor.noEvents")}</p>
            ) : (
              events.map((event) => (
                <Checkbox
                  key={event.id}
                  label={event.title}
                  checked={eventIds.includes(event.id)}
                  onChange={(change) =>
                    setEventIds((current) =>
                      change.target.checked
                        ? [...current, event.id]
                        : current.filter((value) => value !== event.id),
                    )
                  }
                />
              ))
            )}
          </Fieldset>
        </Card>

        <FormAlert>{error}</FormAlert>
        <StatusMessage state={state === "busy" ? "busy" : "idle"}>
          {t("admin.guests.import.importing")}
        </StatusMessage>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            disabled={state === "busy" || sum.importable === 0}
            onClick={confirm}
          >
            {t("admin.guests.import.confirm", { n: sum.importable })}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={state === "busy"}
            onClick={() => {
              setStep("choose");
              setRows([]);
              setError(null);
            }}
          >
            {t("admin.guests.import.other")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Card as="section" aria-labelledby={`${id}-choose`}>
      <h2 id={`${id}-choose`} className="text-2xl font-medium">
        {t("admin.guests.import.choose.title")}
      </h2>
      <p className="text-muted mt-2 max-w-prose">{t("admin.guests.import.choose.intro")}</p>
      <ul className="text-muted mt-3 list-disc pl-6">
        <li>{t("admin.guests.import.choose.col1")}</li>
        <li>{t("admin.guests.import.choose.col2")}</li>
        <li>{t("admin.guests.import.choose.col3")}</li>
        <li>{t("admin.guests.import.choose.col4")}</li>
      </ul>
      <div className="mt-3 flex flex-wrap gap-x-2">
        <a href={`${templateUrl}?format=xlsx`} className={buttonVariants({ variant: "text" })}>
          {t("admin.guests.import.choose.templateXlsx")}
        </a>
        <a href={`${templateUrl}?format=csv`} className={buttonVariants({ variant: "text" })}>
          {t("admin.guests.import.choose.templateCsv")}
        </a>
      </div>
      <form onSubmit={loadPreview} className="mt-5 flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-file`} className="text-ink font-medium">
            {t("admin.guests.import.choose.file")}
          </label>
          <p id={`${id}-file-hint`} className="text-muted text-sm">
            {t("admin.guests.import.choose.fileHint", {
              size: Math.round(IMPORT_LIMITS.fileBytes / 1024 / 1024),
              rows: IMPORT_LIMITS.rows,
            })}
          </p>
          <input
            ref={fileInput}
            id={`${id}-file`}
            type="file"
            accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-describedby={`${id}-file-hint`}
            className="min-h-target text-ink w-full text-base"
          />
        </div>
        <FormAlert>{error}</FormAlert>
        <StatusMessage state={state === "busy" ? "busy" : "idle"}>
          {t("admin.guests.import.reading")}
        </StatusMessage>
        <div>
          <Button type="submit" disabled={state === "busy"}>
            <Icon icon={FileSpreadsheet} size={18} />
            {t("admin.guests.import.choose.submit")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
