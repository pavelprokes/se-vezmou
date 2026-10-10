"use client";

import { Check, Gift, Lock } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import type { GiftRegistryView } from "@/site/gifts";
import { reserveGiftAction, unreserveGiftAction, type GiftState } from "./actions";

export interface RegistryLabels {
  title: string;
  intro: string;
  shop: string;
  newTab: string;
  free: string;
  taken: string;
  mine: string;
  reserve: string;
  reserveLabel: string;
  confirm: string;
  cancel: string;
  name: string;
  nameHint: string;
  unreserve: string;
  unreserveLabel: string;
  reserved: string;
  unreserved: string;
  errors: Record<Exclude<GiftState["status"], "ok">, string>;
}

/** Dar s texty už ve správném jazyce (převod a typografie na serveru). */
export interface RegistryEntry {
  id: string;
  title: string;
  titleLang?: string;
  description: string;
  url: string | null;
  price: string | null;
  reserved: boolean;
  mine: boolean;
}

function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/**
 * Seznam věcných darů na webu páru (fáze 2): host dar zarezervuje bez účtu (jméno nepovinné), ostatní
 * vidí „zabráno“, vlastní rezervaci zruší z téhož prohlížeče. Stav i chyby slovy v živé oblasti.
 */
export function GiftRegistryList({
  labels,
  locale,
  initial,
  localize,
}: {
  labels: RegistryLabels;
  locale: string;
  initial: RegistryEntry[];
  /** Texty darů pro obnovený seznam (id -> přeložené texty), aby klient nic nepřekládal. */
  localize: Record<string, Pick<RegistryEntry, "title" | "titleLang" | "description">>;
}) {
  const id = useId();
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function refresh(registry: GiftRegistryView | null | undefined) {
    if (!registry) return;
    setItems(
      registry.items
        .filter((item) => localize[item.id])
        .map((item) => ({
          id: item.id,
          ...localize[item.id],
          url: item.url,
          price: item.price,
          reserved: item.reserved,
          mine: item.mine,
        })),
    );
  }

  function act(kind: "reserve" | "unreserve", entry: RegistryEntry, formData: FormData) {
    formData.set("gift", entry.id);
    formData.set("locale", locale);
    startTransition(async () => {
      const result =
        kind === "reserve"
          ? await reserveGiftAction(formData)
          : await unreserveGiftAction(formData);
      refresh(result.registry);
      if (result.status === "ok") {
        setOpen(null);
        setMessage(
          fill(kind === "reserve" ? labels.reserved : labels.unreserved, { gift: entry.title }),
        );
      } else {
        setMessage(labels.errors[result.status]);
      }
    });
  }

  return (
    <div className="site-registry">
      <h3 className="site-h3">{labels.title}</h3>
      {labels.intro ? <p className="site-muted">{labels.intro}</p> : null}
      <div role="status" aria-live="polite" className="site-registry-status">
        {message ? <p>{message}</p> : null}
      </div>
      <ul className="site-registry-list">
        {items.map((entry) => {
          const formId = `${id}-${entry.id}`;
          return (
            <li key={entry.id} className="site-registry-item" data-testid="registry-item">
              <div className="site-registry-head">
                <span className="site-registry-title" lang={entry.titleLang}>
                  <Icon icon={Gift} size={20} />
                  {entry.title}
                </span>
                {entry.price ? <span className="site-muted">{entry.price}</span> : null}
              </div>
              {entry.description ? <p className="site-muted">{entry.description}</p> : null}
              {entry.url ? (
                <p>
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="site-link"
                  >
                    {labels.shop}
                    <span className="sr-only"> {labels.newTab}</span>
                  </a>
                </p>
              ) : null}
              {entry.mine ? (
                <div className="site-registry-state">
                  <p className="site-registry-flag">
                    <Icon icon={Check} size={18} />
                    <span>{labels.mine}</span>
                  </p>
                  <form
                    action={(formData) => act("unreserve", entry, formData)}
                    className="site-registry-actions"
                  >
                    <button
                      type="submit"
                      className="site-btn site-btn-secondary"
                      aria-disabled={pending || undefined}
                      aria-label={fill(labels.unreserveLabel, { gift: entry.title })}
                    >
                      {labels.unreserve}
                    </button>
                  </form>
                </div>
              ) : entry.reserved ? (
                <p className="site-registry-flag">
                  <Icon icon={Lock} size={18} />
                  <span>{labels.taken}</span>
                </p>
              ) : open === entry.id ? (
                <form
                  action={(formData) => act("reserve", entry, formData)}
                  className="site-registry-form"
                  aria-labelledby={`${formId}-legend`}
                >
                  <p id={`${formId}-legend`} className="site-field-label">
                    {fill(labels.reserveLabel, { gift: entry.title })}
                  </p>
                  <div className="site-field">
                    <label htmlFor={`${formId}-name`} className="site-field-label">
                      {labels.name}
                    </label>
                    <p id={`${formId}-hint`} className="site-muted site-hint">
                      {labels.nameHint}
                    </p>
                    <input
                      id={`${formId}-name`}
                      name="name"
                      className="site-input"
                      autoComplete="name"
                      maxLength={80}
                      aria-describedby={`${formId}-hint`}
                    />
                  </div>
                  <div className="site-registry-actions">
                    <button type="submit" className="site-btn" aria-disabled={pending || undefined}>
                      {labels.confirm}
                    </button>
                    <button
                      type="button"
                      className="site-btn site-btn-secondary"
                      onClick={() => setOpen(null)}
                    >
                      {labels.cancel}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="site-registry-state">
                  <p className="site-muted">{labels.free}</p>
                  <button
                    type="button"
                    className="site-btn"
                    onClick={() => {
                      setOpen(entry.id);
                      setMessage(null);
                      requestAnimationFrame(() =>
                        document.getElementById(`${formId}-name`)?.focus(),
                      );
                    }}
                    aria-label={fill(labels.reserveLabel, { gift: entry.title })}
                  >
                    {labels.reserve}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
