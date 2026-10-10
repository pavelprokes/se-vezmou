"use client";

import { ArrowDown, ArrowUp, Gift, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import type { GiftActionResult, GiftCommand } from "@/admin/gifts/server";
import type { GiftInput, GiftItem } from "@/admin/gifts/types";
import type { Guarded } from "@/admin/site/action-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Icon } from "@/components/ui/icon";
import { intlLocale, type Locale } from "@/i18n/config";
import { pick, type I18nText } from "@/site/i18n-text";
import { LocalizedField } from "../fields";
import { StatusMessage } from "../guests/status";
import { useAdminT, type AdminKey } from "../i18n";

interface Draft {
  title: I18nText | null;
  description: I18nText | null;
  url: string;
  price: string;
}

const EMPTY: Draft = { title: null, description: null, url: "", price: "" };

/**
 * Správa seznamu věcných darů (fáze 2): přidání a úprava v jednom formuláři, pořadí šipkami, smazání
 * a uvolnění rezervace. Stav slovy v živé oblasti, chyba formuláře u formuláře.
 */
export function GiftRegistry({
  initial,
  locales,
  save,
  command,
}: {
  initial: GiftItem[];
  locales: Locale[];
  save: (id: string | null, input: GiftInput) => Promise<Guarded<GiftActionResult>>;
  command: (id: string, command: GiftCommand) => Promise<Guarded<GiftActionResult>>;
}) {
  const t = useAdminT();
  const id = useId();
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<AdminKey | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const day = new Intl.DateTimeFormat(intlLocale[t.locale], { dateStyle: "medium" });
  const fallback = locales[0];
  const name = (item: GiftItem) => pick(item.title, t.locale, fallback) || "?";

  function handle(result: Guarded<GiftActionResult>, done: string): boolean {
    switch (result.status) {
      case "ok":
        setItems(result.items);
        setError(null);
        setStatus(done);
        return true;
      case "invalid":
        setError("admin.gifts.error.invalid");
        return false;
      case "limit":
        setError("admin.gifts.error.limit");
        return false;
      case "not_found":
        setError("admin.gifts.error.notFound");
        return false;
      case "limited":
        setError("admin.gifts.error.limited");
        return false;
      case "unauthorized":
        setError("admin.guests.error.unauthorized");
        return false;
      default:
        setError("admin.gifts.error.failed");
        return false;
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!draft.title || !Object.values(draft.title).some((v) => v?.trim())) {
      setError("admin.gifts.error.title");
      return;
    }
    if (draft.url.trim() !== "" && !/^https:\/\/\S+$/.test(draft.url.trim())) {
      setError("admin.gifts.error.url");
      return;
    }
    const input: GiftInput = {
      title: draft.title,
      description: draft.description,
      url: draft.url.trim() || null,
      price: draft.price.trim() || null,
    };
    const wasEditing = editing;
    startTransition(async () => {
      const ok = handle(
        await save(wasEditing, input),
        wasEditing ? t("admin.gifts.updated") : t("admin.gifts.added"),
      );
      if (ok) {
        setDraft(EMPTY);
        setEditing(null);
      }
    });
  }

  function run(item: GiftItem, cmd: GiftCommand) {
    if (pending) return;
    const done =
      cmd === "delete"
        ? t("admin.gifts.deleted", { name: name(item) })
        : cmd === "release"
          ? t("admin.gifts.released", { name: name(item) })
          : t("admin.gifts.moved", { name: name(item) });
    startTransition(async () => {
      handle(await command(item.id, cmd), done);
    });
  }

  function edit(item: GiftItem) {
    setEditing(item.id);
    setDraft({
      title: item.title,
      description: item.description,
      url: item.url ?? "",
      price: item.price ?? "",
    });
    setError(null);
    formRef.current?.scrollIntoView({ block: "start" });
    requestAnimationFrame(() => formRef.current?.querySelector("input")?.focus());
  }

  return (
    <div className="flex flex-col gap-6">
      <Card as="section" aria-labelledby={`${id}-list`}>
        <h2 id={`${id}-list`} className="text-2xl font-medium">
          {t("admin.gifts.list", { n: items.length })}
        </h2>
        <StatusMessage state={pending ? "busy" : status ? "done" : "idle"}>
          {pending ? t("admin.common.saving") : status}
        </StatusMessage>
        {items.length === 0 ? (
          <p className="text-muted mt-3">{t("admin.gifts.empty")}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3" data-testid="gift-list">
            {items.map((item, index) => {
              const title = name(item);
              const description = item.description
                ? pick(item.description, t.locale, fallback)
                : "";
              return (
                <li
                  key={item.id}
                  className="border-hairline bg-parchment flex flex-col gap-2 rounded-2xl border p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-lg font-medium">{title}</h3>
                    {item.price ? <span className="text-muted">{item.price}</span> : null}
                  </div>
                  {description ? <p className="text-muted max-w-prose">{description}</p> : null}
                  {item.url ? (
                    <p className="text-sm break-all">
                      <a
                        href={item.url}
                        className="text-pine underline underline-offset-4"
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {item.url}
                      </a>
                    </p>
                  ) : null}
                  <p className="flex items-center gap-2 font-medium">
                    <Icon icon={Gift} size={18} />
                    {item.reservedAt
                      ? item.reservedBy
                        ? t("admin.gifts.reservedBy", {
                            name: item.reservedBy,
                            date: day.format(new Date(item.reservedAt)),
                          })
                        : t("admin.gifts.reserved", { date: day.format(new Date(item.reservedAt)) })
                      : t("admin.gifts.free")}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      type="button"
                      variant="text"
                      onClick={() => edit(item)}
                      aria-label={t("admin.gifts.editLabel", { name: title })}
                    >
                      <Icon icon={Pencil} size={18} />
                      {t("admin.gifts.edit")}
                    </Button>
                    <Button
                      type="button"
                      variant="text"
                      disabled={index === 0}
                      onClick={() => run(item, "up")}
                      aria-label={t("admin.gifts.up", { name: title })}
                    >
                      <Icon icon={ArrowUp} size={18} />
                    </Button>
                    <Button
                      type="button"
                      variant="text"
                      disabled={index === items.length - 1}
                      onClick={() => run(item, "down")}
                      aria-label={t("admin.gifts.down", { name: title })}
                    >
                      <Icon icon={ArrowDown} size={18} />
                    </Button>
                    {item.reservedAt ? (
                      <Button
                        type="button"
                        variant="text"
                        onClick={() => run(item, "release")}
                        aria-label={t("admin.gifts.releaseLabel", { name: title })}
                      >
                        <Icon icon={Undo2} size={18} />
                        {t("admin.gifts.release")}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="text"
                      onClick={() => run(item, "delete")}
                      aria-label={t("admin.gifts.deleteLabel", { name: title })}
                    >
                      <Icon icon={Trash2} size={18} />
                      {t("admin.gifts.delete")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card as="section" aria-labelledby={`${id}-form`}>
        <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-4">
          <h2 id={`${id}-form`} className="text-2xl font-medium">
            {editing ? t("admin.gifts.form.edit") : t("admin.gifts.form.add")}
          </h2>
          <LocalizedField
            label={t("admin.gifts.form.title")}
            value={draft.title}
            locales={locales}
            maxLength={120}
            required
            onChange={(title) => setDraft({ ...draft, title })}
          />
          <LocalizedField
            label={t("admin.gifts.form.description")}
            hint={t("admin.gifts.form.descriptionHint")}
            value={draft.description}
            locales={locales}
            multiline
            maxLength={500}
            onChange={(description) => setDraft({ ...draft, description })}
          />
          <Field
            label={t("admin.gifts.form.url")}
            hint={t("admin.gifts.form.urlHint")}
            type="url"
            inputMode="url"
            maxLength={500}
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          />
          <Field
            label={t("admin.gifts.form.price")}
            hint={t("admin.gifts.form.priceHint")}
            maxLength={40}
            value={draft.price}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
          />
          <FormAlert>{error ? t(error) : null}</FormAlert>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending}>
              <Icon icon={editing ? Pencil : Plus} size={18} />
              {editing ? t("admin.gifts.form.save") : t("admin.gifts.form.submit")}
            </Button>
            {editing ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditing(null);
                  setDraft(EMPTY);
                  setError(null);
                }}
              >
                {t("admin.common.cancel")}
              </Button>
            ) : null}
          </div>
        </form>
      </Card>
    </div>
  );
}
