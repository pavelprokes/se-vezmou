"use client";

import { CircleAlert, LockOpen } from "lucide-react";
import { useActionState, useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { unlockAction, type PinState } from "./actions";

/**
 * Formulář PINu hostů (FR-PRIV-2). Ověřuje server (`unlockAction`): chybný PIN, omezení pokusů
 * a pauzy po chybách. Po úspěchu server nastaví relaci hosta v cookie a stránka se překreslí
 * s citlivými bloky (číslo účtu, soukromá adresa); formulář zmizí a zaměření přejde na odemčený
 * obsah (`UnlockedRegion`). Funguje i bez JavaScriptu (Server Action jako `action` formuláře).
 */

export interface PinGateLabels {
  title: string;
  body: string;
  label: string;
  submit: string;
  hint: string;
  sending: string;
  errors: {
    format: string;
    invalid: string;
    /** Šablona s `{pause}`. */
    locked: string;
    limited: string;
    generic: string;
  };
}

export interface PinGateProps {
  labels: PinGateLabels;
  locale: string;
  /** Které odemčené místo má po úspěchu dostat zaměření (`gifts`, `venue:<id>`); páruje se s `UnlockedRegion`. */
  unlockKey: string;
  /** Úroveň nadpisu formuláře (uvnitř karty místa je to 4). */
  headingLevel?: 3 | 4;
}

const FLAG = "sv-unlocked";

function remember(key: string | null) {
  try {
    if (key) window.sessionStorage.setItem(FLAG, key);
    else window.sessionStorage.removeItem(FLAG);
  } catch {
    // úložiště nemusí být k dispozici (soukromé okno); zaměření se pak jen nepřesune
  }
}

export function PinGate({ labels, locale, unlockKey, headingLevel = 3 }: PinGateProps) {
  const id = useId();
  const [state, action, pending] = useActionState<PinState, FormData>(unlockAction, null);
  const input = useRef<HTMLInputElement>(null);
  const Heading = `h${headingLevel}` as const;

  useEffect(() => {
    if (state?.error) {
      remember(null);
      input.current?.focus();
    }
  }, [state]);

  const message = state?.error
    ? state.error === "locked"
      ? labels.errors.locked.replace("{pause}", state.pause ?? "")
      : labels.errors[state.error]
    : undefined;

  return (
    <form
      className="site-pin"
      aria-labelledby={`${id}-title`}
      action={action}
      onSubmit={(event) => {
        // Tlačítko není `disabled` (zaměření by zmizelo), dvojí odeslání se hlídá tady.
        if (pending) event.preventDefault();
        else remember(unlockKey);
      }}
      noValidate
    >
      <Heading id={`${id}-title`} className="site-h3">
        {labels.title}
      </Heading>
      <p className="site-muted">{labels.body}</p>
      <input type="hidden" name="locale" value={locale} />
      <div className="site-pin-row">
        <label htmlFor={`${id}-pin`} className="site-label">
          {labels.label}
        </label>
        <input
          ref={input}
          id={`${id}-pin`}
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          required
          aria-invalid={message ? true : undefined}
          aria-describedby={`${id}-hint${message ? ` ${id}-error` : ""}`}
          className="site-input"
        />
        <button type="submit" className="site-btn" aria-disabled={pending || undefined}>
          {pending ? labels.sending : labels.submit}
        </button>
      </div>
      <p id={`${id}-hint`} className="site-muted site-hint">
        {labels.hint}
      </p>
      {/* Živá oblast je v DOM vždy, aby čtečky novou chybu po odeslání oznámily (WCAG 4.1.3). */}
      <div role="alert" className="site-alert-slot">
        {message ? (
          <p id={`${id}-error`} className="site-error">
            <Icon icon={CircleAlert} size={20} />
            <span>{message}</span>
          </p>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Odemčený obsah za PINem. Hned po zadání PINu (formulář zmizel) přijímá zaměření, aby klávesnice
 * a čtečka nezůstaly na odstraněném tlačítku; při běžném načtení stránky zaměření nekrade.
 */
export function UnlockedRegion({
  label,
  unlockKey,
  children,
}: {
  label: string;
  unlockKey: string;
  children: ReactNode;
}) {
  const region = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      // PIN se zadává v jednom z formulářů, ale odemknou se všechna místa: zaměření dostane jen to,
      // jehož formulář se odeslal.
      if (window.sessionStorage.getItem(FLAG) === unlockKey) {
        window.sessionStorage.removeItem(FLAG);
        region.current?.focus();
      }
    } catch {
      // bez úložiště se zaměření nepřesouvá
    }
  }, [unlockKey]);

  return (
    <div ref={region} role="group" aria-label={label} tabIndex={-1} className="site-unlocked">
      <p className="site-unlocked-note site-muted">
        <Icon icon={LockOpen} size={18} />
        <span>{label}</span>
      </p>
      {children}
    </div>
  );
}
