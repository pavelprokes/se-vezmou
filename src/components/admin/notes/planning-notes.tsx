"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import type { NotesResult, VendorActionResult } from "@/admin/notes/server";
import {
  NOTES_MAX,
  vendorCategories,
  vendorStatuses,
  type Vendor,
  type VendorCategory,
  type VendorInput,
  type VendorStatus,
} from "@/admin/notes/types";
import type { Guarded } from "@/admin/site/action-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Icon } from "@/components/ui/icon";
import { TextArea } from "@/components/ui/textarea";
import { SelectField } from "../fields";
import { StatusMessage } from "../guests/status";
import { useAdminT, type AdminKey } from "../i18n";

const CATEGORY = (c: VendorCategory) => `admin.notes.category.${c}` as AdminKey;
const STATUS = (s: VendorStatus) => `admin.notes.status.${s}` as AdminKey;

interface Draft {
  category: VendorCategory;
  name: string;
  contact: string;
  url: string;
  price: string;
  status: VendorStatus;
  note: string;
}

const EMPTY: Draft = {
  category: "photo",
  name: "",
  contact: "",
  url: "",
  price: "",
  status: "idea",
  note: "",
};

/**
 * Soukromé poznámky a kontakty na dodavatele (fáze 2). Hostům se nezobrazují; jsou jen pro správce
 * svatby. Poznámky jsou jeden text s uložením tlačítkem a hlídáním souběžné úpravy.
 */
export function PlanningNotes({
  vendors: initialVendors,
  notes: initialNotes,
  saveVendor,
  deleteVendor,
  saveNotes,
}: {
  vendors: Vendor[];
  notes: { body: string; rev: number };
  saveVendor: (id: string | null, input: VendorInput) => Promise<Guarded<VendorActionResult>>;
  deleteVendor: (id: string) => Promise<Guarded<VendorActionResult>>;
  saveNotes: (input: unknown) => Promise<Guarded<NotesResult>>;
}) {
  const t = useAdminT();
  const id = useId();
  const [vendors, setVendors] = useState(initialVendors);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [vendorError, setVendorError] = useState<AdminKey | null>(null);
  const [vendorStatus, setVendorStatus] = useState<string | null>(null);
  const [body, setBody] = useState(initialNotes.body);
  const [notesError, setNotesError] = useState<AdminKey | null>(null);
  const [notesSaved, setNotesSaved] = useState(false);
  const rev = useRef(initialNotes.rev);
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [notesPending, startNotes] = useTransition();

  function handle(result: Guarded<VendorActionResult>, done: string): boolean {
    if (result.status === "ok") {
      setVendors(result.vendors);
      setVendorError(null);
      setVendorStatus(done);
      return true;
    }
    setVendorError(
      result.status === "invalid"
        ? "admin.notes.error.invalid"
        : result.status === "limit"
          ? "admin.notes.error.limit"
          : result.status === "limited"
            ? "admin.notes.error.limited"
            : result.status === "unauthorized"
              ? "admin.guests.error.unauthorized"
              : "admin.notes.error.failed",
    );
    return false;
  }

  function submitVendor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (draft.name.trim() === "") {
      setVendorError("admin.notes.error.name");
      return;
    }
    if (draft.url.trim() !== "" && !/^https:\/\/\S+$/.test(draft.url.trim())) {
      setVendorError("admin.notes.error.url");
      return;
    }
    const input: VendorInput = {
      ...draft,
      contact: draft.contact || null,
      url: draft.url.trim() || null,
      price: draft.price || null,
      note: draft.note || null,
    };
    const current = editing;
    startTransition(async () => {
      if (
        handle(
          await saveVendor(current, input),
          current ? t("admin.notes.vendorUpdated") : t("admin.notes.vendorAdded"),
        )
      ) {
        setDraft(EMPTY);
        setEditing(null);
      }
    });
  }

  function edit(vendor: Vendor) {
    setEditing(vendor.id);
    setDraft({
      category: vendor.category,
      name: vendor.name,
      contact: vendor.contact ?? "",
      url: vendor.url ?? "",
      price: vendor.price ?? "",
      status: vendor.status,
      note: vendor.note ?? "",
    });
    setVendorError(null);
    formRef.current?.scrollIntoView({ block: "start" });
    requestAnimationFrame(() => formRef.current?.querySelector("select")?.focus());
  }

  function submitNotes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (notesPending) return;
    setNotesSaved(false);
    startNotes(async () => {
      const result = await saveNotes({ body, rev: rev.current });
      if (result.status === "saved") {
        rev.current = result.rev;
        setNotesError(null);
        setNotesSaved(true);
      } else {
        setNotesError(
          result.status === "conflict"
            ? "admin.notes.error.conflict"
            : result.status === "limited"
              ? "admin.notes.error.limited"
              : result.status === "unauthorized"
                ? "admin.guests.error.unauthorized"
                : "admin.notes.error.failed",
        );
      }
    });
  }

  const grouped = vendorCategories
    .map((category) => ({ category, items: vendors.filter((v) => v.category === category) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <Card as="section" aria-labelledby={`${id}-vendors`}>
        <h2 id={`${id}-vendors`} className="text-2xl font-medium">
          {t("admin.notes.vendors", { n: vendors.length })}
        </h2>
        <StatusMessage state={pending ? "busy" : vendorStatus ? "done" : "idle"}>
          {pending ? t("admin.common.saving") : vendorStatus}
        </StatusMessage>
        {grouped.length === 0 ? (
          <p className="text-muted mt-3">{t("admin.notes.vendorsEmpty")}</p>
        ) : (
          <div className="mt-3 flex flex-col gap-5" data-testid="vendor-list">
            {grouped.map((group) => (
              <section key={group.category} aria-labelledby={`${id}-cat-${group.category}`}>
                <h3 id={`${id}-cat-${group.category}`} className="text-xl font-medium">
                  {t(CATEGORY(group.category))}
                </h3>
                <ul className="mt-2 grid gap-3 md:grid-cols-2">
                  {group.items.map((vendor) => (
                    <li
                      key={vendor.id}
                      className="border-hairline bg-parchment rounded-2xl border p-4"
                    >
                      <p className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-lg font-medium">{vendor.name}</span>
                        <span className="text-muted">{t(STATUS(vendor.status))}</span>
                      </p>
                      {vendor.contact ? <p className="mt-1 break-words">{vendor.contact}</p> : null}
                      {vendor.url ? (
                        <p className="mt-1 text-sm break-all">
                          <a
                            href={vendor.url}
                            className="text-pine underline underline-offset-4"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {vendor.url}
                          </a>
                        </p>
                      ) : null}
                      {vendor.price ? <p className="text-muted mt-1">{vendor.price}</p> : null}
                      {vendor.note ? (
                        <p className="mt-2 whitespace-pre-line">{vendor.note}</p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Button
                          type="button"
                          variant="text"
                          onClick={() => edit(vendor)}
                          aria-label={t("admin.notes.editLabel", { name: vendor.name })}
                        >
                          <Icon icon={Pencil} size={18} />
                          {t("admin.notes.edit")}
                        </Button>
                        <Button
                          type="button"
                          variant="text"
                          onClick={() =>
                            startTransition(async () => {
                              handle(
                                await deleteVendor(vendor.id),
                                t("admin.notes.vendorDeleted", { name: vendor.name }),
                              );
                            })
                          }
                          aria-label={t("admin.notes.deleteLabel", { name: vendor.name })}
                        >
                          <Icon icon={Trash2} size={18} />
                          {t("admin.notes.delete")}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>

      <Card as="section" aria-labelledby={`${id}-form`}>
        <form ref={formRef} onSubmit={submitVendor} noValidate className="flex flex-col gap-4">
          <h2 id={`${id}-form`} className="text-2xl font-medium">
            {editing ? t("admin.notes.form.edit") : t("admin.notes.form.add")}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField
              label={t("admin.notes.form.category")}
              value={draft.category}
              onChange={(value) => setDraft({ ...draft, category: value as VendorCategory })}
            >
              {vendorCategories.map((category) => (
                <option key={category} value={category}>
                  {t(CATEGORY(category))}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={t("admin.notes.form.status")}
              value={draft.status}
              onChange={(value) => setDraft({ ...draft, status: value as VendorStatus })}
            >
              {vendorStatuses.map((status) => (
                <option key={status} value={status}>
                  {t(STATUS(status))}
                </option>
              ))}
            </SelectField>
            <Field
              label={t("admin.notes.form.name")}
              required
              maxLength={120}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <Field
              label={t("admin.notes.form.contact")}
              hint={t("admin.notes.form.contactHint")}
              maxLength={200}
              value={draft.contact}
              onChange={(e) => setDraft({ ...draft, contact: e.target.value })}
            />
            <Field
              label={t("admin.notes.form.url")}
              type="url"
              inputMode="url"
              maxLength={500}
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            />
            <Field
              label={t("admin.notes.form.price")}
              maxLength={60}
              value={draft.price}
              onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            />
          </div>
          <TextArea
            label={t("admin.notes.form.note")}
            rows={3}
            maxLength={2000}
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
          <FormAlert>{vendorError ? t(vendorError) : null}</FormAlert>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending}>
              <Icon icon={editing ? Pencil : Plus} size={18} />
              {editing ? t("admin.notes.form.save") : t("admin.notes.form.submit")}
            </Button>
            {editing ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditing(null);
                  setDraft(EMPTY);
                  setVendorError(null);
                }}
              >
                {t("admin.common.cancel")}
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      <Card as="section" aria-labelledby={`${id}-notes`}>
        <form onSubmit={submitNotes} noValidate className="flex flex-col gap-4">
          <h2 id={`${id}-notes`} className="text-2xl font-medium">
            {t("admin.notes.notes")}
          </h2>
          <TextArea
            label={t("admin.notes.notesLabel")}
            hint={t("admin.notes.notesHint")}
            rows={12}
            maxLength={NOTES_MAX}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setNotesSaved(false);
            }}
          />
          <FormAlert>{notesError ? t(notesError) : null}</FormAlert>
          <StatusMessage state={notesPending ? "busy" : notesSaved ? "done" : "idle"}>
            {notesPending ? t("admin.common.saving") : t("admin.notes.notesSaved")}
          </StatusMessage>
          <div>
            <Button type="submit" disabled={notesPending}>
              {t("admin.notes.notesSave")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
