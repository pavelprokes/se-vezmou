"use client";

import { ArrowDown, ArrowUp, Printer, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  applyLayout,
  buildLayout,
  capacity,
  moveSeat,
  occupancy,
  seat,
  seatingPresets,
  type PresetParams,
  type SeatingPlan,
  type SeatingPreset,
  type TableLabels,
} from "@/admin/seating/layout";
import type { SaveSeatingResult } from "@/admin/seating/server";
import type { Guarded } from "@/admin/site/action-types";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Radio } from "@/components/ui/choice";
import { Field, Fieldset } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Icon } from "@/components/ui/icon";
import { SelectField } from "../fields";
import { StatusMessage } from "../guests/status";
import { useAdminT, type AdminKey } from "../i18n";
import { SeatingMap } from "./seating-map";

export interface PlannerPerson {
  key: string;
  name: string;
  group: string;
  groupLabel: string;
  isChild: boolean;
  age: number | null;
  isPlusOne: boolean;
  attending: string[];
}

export interface PlannerEvent {
  id: string;
  title: string;
}

const PRESET_KEYS: Record<SeatingPreset, { label: AdminKey; hint: AdminKey }> = {
  round: {
    label: "admin.guests.seating.preset.round",
    hint: "admin.guests.seating.preset.round.hint",
  },
  long: {
    label: "admin.guests.seating.preset.long",
    hint: "admin.guests.seating.preset.long.hint",
  },
  t: { label: "admin.guests.seating.preset.t", hint: "admin.guests.seating.preset.t.hint" },
  u: { label: "admin.guests.seating.preset.u", hint: "admin.guests.seating.preset.u.hint" },
  comb: {
    label: "admin.guests.seating.preset.comb",
    hint: "admin.guests.seating.preset.comb.hint",
  },
  banquet: {
    label: "admin.guests.seating.preset.banquet",
    hint: "admin.guests.seating.preset.banquet.hint",
  },
  mixed: {
    label: "admin.guests.seating.preset.mixed",
    hint: "admin.guests.seating.preset.mixed.hint",
  },
};

/** Která pole parametrů má která předvolba. */
const FIELDS: Record<SeatingPreset, (keyof PresetParams)[]> = {
  round: ["tables", "seats"],
  long: ["side", "ends"],
  t: ["head", "side"],
  u: ["head", "side", "inner"],
  comb: ["head", "arms", "side"],
  banquet: ["tables", "banquetSeats"],
  mixed: ["head", "tables", "seats"],
};

const LIMITS: Record<Exclude<keyof PresetParams, "inner" | "ends">, [number, number]> = {
  tables: [1, 60],
  seats: [4, 12],
  banquetSeats: [4, 8],
  head: [2, 20],
  side: [2, 40],
  arms: [2, 5],
};

type SaveState = "idle" | "busy" | "done";

/**
 * Plánovač zasedacího pořádku (fáze 2): předvolba rozložení s rozměry, schematický plánek a usazení
 * hostů výběrem stolu ze seznamu (bez tahání myší, celé ovladatelné klávesnicí), domácnost najednou.
 * Ukládá se samo po každé změně; souběžnou úpravu jiného správce hlásí slovy.
 */
export function SeatingPlanner({
  initial,
  rev: initialRev,
  people,
  events,
  printHref,
  save,
}: {
  initial: SeatingPlan;
  rev: number;
  people: PlannerPerson[];
  events: PlannerEvent[];
  printHref: string;
  save: (input: unknown) => Promise<Guarded<SaveSeatingResult>>;
}) {
  const t = useAdminT();
  const id = useId();
  const [plan, setPlan] = useState(initial);
  const [preset, setPreset] = useState<SeatingPreset>(initial.preset);
  const [params, setParams] = useState<PresetParams>(initial.params);
  const [onlyFree, setOnlyFree] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<AdminKey | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rev = useRef(initialRev);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const latest = useRef(plan);

  const labels: TableLabels = useMemo(
    () => ({
      table: (n) => t("admin.guests.seating.table.n", { n }),
      head: t("admin.guests.seating.table.head"),
      long: t("admin.guests.seating.table.long"),
      leg: t("admin.guests.seating.table.leg"),
      left: t("admin.guests.seating.table.left"),
      right: t("admin.guests.seating.table.right"),
      arm: (n) => t("admin.guests.seating.table.arm", { n }),
    }),
    [t],
  );

  const seated = useMemo(
    () =>
      people.filter((p) =>
        plan.eventId === null ? p.attending.length > 0 : p.attending.includes(plan.eventId),
      ),
    [people, plan.eventId],
  );
  const byKey = useMemo(() => new Map(people.map((p) => [p.key, p])), [people]);
  const assignedCount = seated.filter((p) => plan.assignments[p.key]).length;
  const preview = useMemo(() => buildLayout(preset, params, labels), [preset, params, labels]);
  const total = capacity(plan.tables);

  async function flush() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaveState("busy");
    try {
      while (dirty.current) {
        dirty.current = false;
        const result = await save({ plan: latest.current, rev: rev.current });
        if (result.status === "saved") {
          rev.current = result.rev;
          setError(null);
        } else {
          setError(
            result.status === "conflict"
              ? "admin.guests.seating.error.conflict"
              : result.status === "limited"
                ? "admin.guests.seating.error.limited"
                : result.status === "unauthorized"
                  ? "admin.guests.error.unauthorized"
                  : "admin.guests.seating.error.failed",
          );
          setSaveState("idle");
          return;
        }
      }
      if (!dirty.current) setSaveState("done");
    } finally {
      inFlight.current = false;
    }
  }

  // Automatické uložení: po změně plánu s krátkou prodlevou, nikdy dvě uložení najednou.
  useEffect(() => {
    latest.current = plan;
    if (!dirty.current) return;
    const timer = setTimeout(() => void flush(), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  function update(next: SeatingPlan) {
    dirty.current = true;
    // neuložená změna: hláška „uloženo“ by do dalšího uložení lhala
    setSaveState("idle");
    setNotice(null);
    setPlan(next);
  }

  function applyPreset() {
    const { plan: next, released } = applyLayout(plan, buildLayout(preset, params, labels));
    update(next);
    setNotice(
      released > 0
        ? t("admin.guests.seating.applied.released", { n: released })
        : t("admin.guests.seating.applied"),
    );
  }

  function seatKeys(keys: string[], tableId: string) {
    const { plan: next, left } = seat(plan, keys, tableId === "" ? null : tableId);
    update(next);
    if (left.length > 0) {
      setNotice(
        t("admin.guests.seating.full", {
          names: left.map((key) => byKey.get(key)?.name ?? "").join(", "),
        }),
      );
    }
  }

  const tableOption = (tableId: string, current: string | undefined) => {
    const table = plan.tables.find((x) => x.id === tableId)!;
    const free = table.seats - occupancy(plan, table.id).size;
    return (
      <option key={table.id} value={table.id} disabled={free === 0 && current !== table.id}>
        {t("admin.guests.seating.option", { table: table.label, free, seats: table.seats })}
      </option>
    );
  };

  // skupiny (domácnosti) v pořadí ze serveru
  const groups = useMemo(() => {
    const map = new Map<string, PlannerPerson[]>();
    for (const person of seated) {
      if (onlyFree && plan.assignments[person.key]) continue;
      map.set(person.group, [...(map.get(person.group) ?? []), person]);
    }
    return [...map.values()];
  }, [seated, onlyFree, plan.assignments]);

  const describe = (person: PlannerPerson) =>
    person.isChild
      ? person.age === null
        ? t("admin.guests.seating.child")
        : t("admin.guests.seating.childAge", { age: person.age })
      : person.isPlusOne
        ? t("admin.guests.seating.plusOne")
        : null;

  const paramLabel = (field: keyof PresetParams): AdminKey =>
    `admin.guests.seating.param.${field}` as AdminKey;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusMessage state={saveState}>
          {saveState === "busy" ? t("admin.common.saving") : t("admin.guests.seating.saved")}
        </StatusMessage>
        <a href={printHref} className={buttonVariants({ variant: "secondary" })}>
          <Icon icon={Printer} size={18} />
          {t("admin.guests.seating.print")}
        </a>
      </div>
      <FormAlert>{error ? t(error) : null}</FormAlert>

      <Card as="section" aria-labelledby={`${id}-layout`}>
        <h2 id={`${id}-layout`} className="text-2xl font-medium">
          {t("admin.guests.seating.layout.title")}
        </h2>
        <p className="text-muted mt-2 max-w-prose">{t("admin.guests.seating.layout.intro")}</p>
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
          <div className="flex flex-col gap-5">
            <Fieldset legend={t("admin.guests.seating.layout.preset")}>
              <div className="flex flex-col gap-1">
                {seatingPresets.map((key) => (
                  <div key={key}>
                    <Radio
                      name={`${id}-preset`}
                      value={key}
                      label={t(PRESET_KEYS[key].label)}
                      checked={preset === key}
                      onChange={() => setPreset(key)}
                    />
                    <p className="text-muted ml-9 text-sm">{t(PRESET_KEYS[key].hint)}</p>
                  </div>
                ))}
              </div>
            </Fieldset>
            <div className="flex flex-col gap-3">
              {FIELDS[preset].map((field) =>
                field === "inner" || field === "ends" ? (
                  <Checkbox
                    key={field}
                    label={t(paramLabel(field))}
                    checked={params[field]}
                    onChange={(e) => setParams({ ...params, [field]: e.target.checked })}
                  />
                ) : (
                  <Field
                    key={field}
                    type="number"
                    inputMode="numeric"
                    label={t(paramLabel(field))}
                    hint={t("admin.guests.seating.param.range", {
                      min: LIMITS[field][0],
                      max: LIMITS[field][1],
                    })}
                    min={LIMITS[field][0]}
                    max={LIMITS[field][1]}
                    value={String(params[field])}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (!Number.isFinite(value)) return;
                      const [min, max] = LIMITS[field];
                      setParams({
                        ...params,
                        [field]: Math.min(max, Math.max(min, Math.round(value))),
                      });
                    }}
                  />
                ),
              )}
            </div>
            <p data-testid="seating-preview-capacity">
              {t("admin.guests.seating.layout.capacity", {
                seats: capacity(preview.tables),
                guests: seated.length,
              })}
            </p>
            {capacity(preview.tables) < seated.length ? (
              <p className="font-medium">{t("admin.guests.seating.layout.tooSmall")}</p>
            ) : null}
            <div>
              <Button type="button" onClick={applyPreset}>
                {plan.tables.length === 0
                  ? t("admin.guests.seating.layout.create")
                  : t("admin.guests.seating.layout.apply")}
              </Button>
            </div>
            <div role="status" aria-live="polite" className="min-h-6">
              {notice ? <p className="font-medium">{notice}</p> : null}
            </div>
          </div>
          <div className="min-w-0">
            {plan.tables.length > 0 ? (
              <>
                <SeatingMap
                  plan={plan}
                  label={t("admin.guests.seating.map.label", {
                    tables: plan.tables.length,
                    seats: total,
                    taken: Object.keys(plan.assignments).length,
                  })}
                  className="text-ink border-hairline h-auto max-h-[36rem] w-full rounded-2xl border"
                />
                <p className="text-muted mt-2 text-sm">{t("admin.guests.seating.map.hint")}</p>
              </>
            ) : (
              <p className="text-muted">{t("admin.guests.seating.map.empty")}</p>
            )}
          </div>
        </div>
      </Card>

      {plan.tables.length > 0 ? (
        <Card as="section" aria-labelledby={`${id}-people`}>
          <h2 id={`${id}-people`} className="text-2xl font-medium">
            {t("admin.guests.seating.people.title")}
          </h2>
          <p className="mt-2 text-lg" data-testid="seating-count">
            {t("admin.guests.seating.people.count", {
              seated: assignedCount,
              total: seated.length,
            })}
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-6">
            {events.length > 1 ? (
              <div className="min-w-64">
                <SelectField
                  label={t("admin.guests.seating.people.event")}
                  value={plan.eventId ?? ""}
                  onChange={(value) => update({ ...plan, eventId: value === "" ? null : value })}
                >
                  <option value="">{t("admin.guests.seating.people.anyEvent")}</option>
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.title}
                    </option>
                  ))}
                </SelectField>
              </div>
            ) : null}
            <Checkbox
              label={t("admin.guests.seating.people.onlyFree")}
              checked={onlyFree}
              onChange={(e) => setOnlyFree(e.target.checked)}
            />
          </div>
          {seated.length === 0 ? (
            <p className="text-muted mt-4">{t("admin.guests.seating.people.none")}</p>
          ) : groups.length === 0 ? (
            <p className="text-muted mt-4">{t("admin.guests.seating.people.allSeated")}</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {groups.map((group) => {
                const label = group[0].groupLabel;
                return (
                  <li
                    key={group[0].group}
                    className="border-hairline bg-parchment rounded-2xl border p-4"
                  >
                    <h3 className="text-lg font-medium">{label}</h3>
                    {group.length > 1 ? (
                      <div className="mt-2 max-w-md">
                        <SelectField
                          label={t("admin.guests.seating.people.household", { name: label })}
                          value=""
                          onChange={(value) =>
                            value &&
                            seatKeys(
                              group.map((p) => p.key),
                              value,
                            )
                          }
                        >
                          <option value="">{t("admin.guests.seating.people.choose")}</option>
                          {plan.tables.map((table) => tableOption(table.id, undefined))}
                        </SelectField>
                      </div>
                    ) : null}
                    <ul className="mt-3 flex flex-col gap-3">
                      {group.map((person) => {
                        const current = plan.assignments[person.key]?.table;
                        const extra = describe(person);
                        return (
                          <li
                            key={person.key}
                            className="grid gap-2 sm:grid-cols-[1fr_minmax(0,18rem)] sm:items-end"
                          >
                            <p>
                              <span className="font-medium">{person.name}</span>
                              {extra ? <span className="text-muted"> · {extra}</span> : null}
                            </p>
                            <SelectField
                              label={t("admin.guests.seating.people.table", { name: person.name })}
                              value={current ?? ""}
                              onChange={(value) => seatKeys([person.key], value)}
                            >
                              <option value="">{t("admin.guests.seating.people.noSeat")}</option>
                              {plan.tables.map((table) => tableOption(table.id, current))}
                            </SelectField>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : null}

      {plan.tables.length > 0 ? (
        <Card as="section" aria-labelledby={`${id}-tables`}>
          <h2 id={`${id}-tables`} className="text-2xl font-medium">
            {t("admin.guests.seating.tables.title")}
          </h2>
          <ul className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {plan.tables.map((table) => {
              const taken = [...occupancy(plan, table.id)].sort(([a], [b]) => a - b);
              return (
                <li key={table.id} className="border-hairline bg-parchment rounded-2xl border p-4">
                  <h3 className="text-lg font-medium" data-testid={`table-${table.id}`}>
                    {t("admin.guests.seating.tables.heading", {
                      table: table.label,
                      taken: taken.length,
                      seats: table.seats,
                    })}
                  </h3>
                  {taken.length === 0 ? (
                    <p className="text-muted mt-2">{t("admin.guests.seating.tables.empty")}</p>
                  ) : (
                    <ol className="mt-2 flex flex-col gap-1">
                      {taken.map(([seatNo, key]) => {
                        const name = byKey.get(key)?.name ?? "?";
                        return (
                          <li key={key} className="flex flex-wrap items-center gap-1">
                            <span className="min-w-0 flex-1">
                              {t("admin.guests.seating.tables.seat", { seat: seatNo, name })}
                            </span>
                            <Button
                              type="button"
                              variant="text"
                              aria-label={t("admin.guests.seating.tables.up", { name })}
                              onClick={() => update(moveSeat(plan, key, -1))}
                              disabled={seatNo === 1}
                            >
                              <Icon icon={ArrowUp} size={18} />
                            </Button>
                            <Button
                              type="button"
                              variant="text"
                              aria-label={t("admin.guests.seating.tables.down", { name })}
                              onClick={() => update(moveSeat(plan, key, 1))}
                              disabled={seatNo === table.seats}
                            >
                              <Icon icon={ArrowDown} size={18} />
                            </Button>
                            <Button
                              type="button"
                              variant="text"
                              aria-label={t("admin.guests.seating.tables.remove", { name })}
                              onClick={() => seatKeys([key], "")}
                            >
                              <Icon icon={X} size={18} />
                            </Button>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
