"use client";

import { Baby, CircleCheck, CircleHelp, CircleX, Pencil, UserPlus } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { BulkInviteAction } from "@/admin/guests/action-types";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/i18n/config";
import { normalizeName } from "@/lib/rsvp/names";
import {
  householdStatus,
  type GuestList as GuestListData,
  type HouseholdStatus,
} from "@/lib/rsvp/types";
import { pick } from "@/site/i18n-text";
import { ConfirmButton } from "../confirm-button";
import { useAdminT, type AdminKey } from "../i18n";
import { go } from "./navigate";
import { StatusMessage } from "./status";

type Filter = "all" | HouseholdStatus;

const STATUS_ICON = { no_response: CircleHelp, attending: CircleCheck, declined: CircleX } as const;
const STATUS_KEY: Record<HouseholdStatus, AdminKey> = {
  no_response: "admin.guests.list.status.no_response",
  attending: "admin.guests.list.status.attending",
  declined: "admin.guests.list.status.declined",
};
const FILTER_KEY: Record<Filter, AdminKey> = {
  all: "admin.guests.list.filter.all",
  no_response: "admin.guests.list.filter.no_response",
  attending: "admin.guests.list.filter.attending",
  declined: "admin.guests.list.filter.declined",
};

/**
 * Seznam domácností a hostů s hledáním a filtrem podle odpovědi (FR-ADM-4). Stav odpovědi je vždy
 * slovy a ikonou. Pod seznamem je hromadné pozvání na událost: nová událost bez pozvání by nikomu
 * nedovolila odpovědět.
 */
export function GuestList({
  data,
  locale,
  hrefs,
  actions,
  saved,
}: {
  data: GuestListData;
  locale: Locale;
  /** Předpony adres (s jazykem), za které se přidá identifikátor domácnosti. */
  hrefs: { add: string; householdPrefix: string; responsePrefix: string };
  actions: { bulkInvite: BulkInviteAction };
  saved: "saved" | "deleted" | null;
}) {
  const t = useAdminT();
  const id = useId();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [bulk, setBulk] = useState<{ state: "idle" | "busy" | "done"; text: string }>({
    state: "idle",
    text: "",
  });

  const eventTitle = useMemo(
    () => new Map(data.events.map((event) => [event.id, pick(event.title, locale, "cs") || "?"])),
    [data.events, locale],
  );
  const guestCount = data.households.reduce((sum, h) => sum + h.guests.length, 0);

  const shown = useMemo(() => {
    const needle = normalizeName(query);
    return data.households.filter((household) => {
      if (filter !== "all" && householdStatus(household) !== filter) return false;
      if (needle === "") return true;
      const hay = normalizeName(
        [household.label, ...household.guests.map((guest) => guest.display_name)].join(" "),
      );
      return hay.includes(needle);
    });
  }, [data.households, query, filter]);

  const invite = async (eventId: string, invited: boolean) => {
    setBulk({ state: "busy", text: t("admin.common.saving") });
    const result = await actions.bulkInvite(eventId, invited);
    if (result.status === "ok") {
      setBulk({ state: "done", text: t("admin.guests.list.bulkDone") });
      go(`${window.location.pathname}?ulozeno=1`);
    } else {
      setBulk({
        state: "done",
        text:
          result.status === "limited"
            ? t("admin.guests.error.limited")
            : t("admin.guests.error.generic"),
      });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {saved ? (
        <div role="status" className="text-ink flex items-center gap-2 font-medium">
          <Icon icon={CircleCheck} />
          <span>
            {saved === "saved" ? t("admin.guests.list.saved") : t("admin.guests.list.deleted")}
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg" data-testid="guest-count">
          {t("admin.guests.list.count", { households: data.households.length, guests: guestCount })}
        </p>
        <a href={hrefs.add} className={buttonVariants()}>
          <Icon icon={UserPlus} size={18} />
          {t("admin.guests.list.add")}
        </a>
      </div>

      {data.households.length > 0 ? (
        <Card as="section" aria-labelledby={`${id}-filter`}>
          <h2 id={`${id}-filter`} className="sr-only">
            {t("admin.guests.list.filterTitle")}
          </h2>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <Field
              className="flex-1"
              label={t("admin.guests.list.search")}
              type="search"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-status`} className="text-ink font-medium">
                {t("admin.guests.list.filterLabel")}
              </label>
              <select
                id={`${id}-status`}
                className="min-h-target rounded-button bg-parchment text-ink border-field-border border-2 px-3 py-2 text-base"
                value={filter}
                onChange={(event) => setFilter(event.target.value as Filter)}
              >
                {(Object.keys(FILTER_KEY) as Filter[]).map((key) => (
                  <option key={key} value={key}>
                    {t(FILTER_KEY[key])}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p role="status" className="text-muted mt-3">
            {t("admin.guests.list.shown", { n: shown.length })}
          </p>
        </Card>
      ) : (
        <Card>
          <p className="text-lg">{t("admin.guests.list.empty")}</p>
        </Card>
      )}

      <ul className="flex flex-col gap-4" aria-label={t("admin.guests.list.households")}>
        {shown.map((household) => {
          const status = householdStatus(household);
          const heading =
            household.label.trim() || household.guests.map((g) => g.display_name).join(", ");
          return (
            <li key={household.id}>
              <Card as="article" aria-labelledby={`${id}-h-${household.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 id={`${id}-h-${household.id}`} className="text-xl font-medium">
                    {heading}
                  </h2>
                  <p className="text-ink flex items-center gap-2 font-medium">
                    <Icon icon={STATUS_ICON[status]} />
                    {t(STATUS_KEY[status])}
                  </p>
                </div>
                {household.invited_note ? (
                  <p className="text-muted mt-1">{household.invited_note}</p>
                ) : null}
                <ul className="mt-3 flex flex-col gap-1">
                  {household.guests.map((guest) => (
                    <li key={guest.id} className="flex flex-wrap items-center gap-x-3">
                      <span className="font-medium">{guest.display_name}</span>
                      {guest.is_child ? (
                        <span className="text-muted flex items-center gap-1 text-sm">
                          <Icon icon={Baby} size={16} />
                          {guest.age !== null
                            ? t("admin.guests.list.childAge", { age: guest.age })
                            : t("admin.guests.list.child")}
                        </span>
                      ) : null}
                      {guest.is_plus_one ? (
                        <span className="text-muted text-sm">{t("admin.guests.list.plusOne")}</span>
                      ) : null}
                      <span className="text-muted text-sm">
                        {guest.invited_event_ids.length > 0
                          ? t("admin.guests.list.invited", {
                              events: guest.invited_event_ids
                                .map((eventId) => eventTitle.get(eventId) ?? "?")
                                .join(", "),
                            })
                          : t("admin.guests.list.notInvited")}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap gap-3">
                  <a
                    href={`${hrefs.householdPrefix}${household.id}`}
                    className={buttonVariants({ variant: "secondary" })}
                    aria-label={t("admin.guests.list.editLabel", { name: heading })}
                  >
                    <Icon icon={Pencil} size={18} />
                    {t("admin.guests.list.edit")}
                  </a>
                  <a
                    href={`${hrefs.responsePrefix}${household.id}`}
                    className={buttonVariants({ variant: "text" })}
                    aria-label={t("admin.guests.list.enterLabel", { name: heading })}
                  >
                    {t("admin.guests.list.enter")}
                  </a>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      {data.events.length > 0 && data.households.length > 0 ? (
        <Card as="section" aria-labelledby={`${id}-bulk`}>
          <h2 id={`${id}-bulk`} className="text-2xl font-medium">
            {t("admin.guests.list.bulkTitle")}
          </h2>
          <p className="text-muted mt-2">{t("admin.guests.list.bulkIntro")}</p>
          <ul className="mt-4 flex flex-col gap-4">
            {data.events.map((event) => {
              const title = eventTitle.get(event.id) ?? "?";
              return (
                <li key={event.id} className="flex flex-col gap-2">
                  <p className="font-medium">{title}</p>
                  <div className="flex flex-wrap gap-3">
                    <ConfirmButton
                      label={t("admin.guests.list.bulkAdd")}
                      ariaLabel={t("admin.guests.list.bulkAddLabel", { event: title })}
                      question={t("admin.guests.list.bulkAddQuestion", {
                        event: title,
                        n: guestCount,
                      })}
                      confirmLabel={t("admin.guests.list.bulkConfirm")}
                      disabled={bulk.state === "busy"}
                      onConfirm={() => invite(event.id, true)}
                    />
                    <ConfirmButton
                      label={t("admin.guests.list.bulkRemove")}
                      ariaLabel={t("admin.guests.list.bulkRemoveLabel", { event: title })}
                      question={t("admin.guests.list.bulkRemoveQuestion", { event: title })}
                      confirmLabel={t("admin.guests.list.bulkConfirm")}
                      variant="text"
                      disabled={bulk.state === "busy"}
                      onConfirm={() => invite(event.id, false)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <StatusMessage state={bulk.state}>{bulk.text}</StatusMessage>
        </Card>
      ) : null}
    </div>
  );
}
