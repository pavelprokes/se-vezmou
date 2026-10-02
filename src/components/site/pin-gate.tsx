"use client";

import { useId } from "react";

export interface PinGateProps {
  title: string;
  body: string;
  label: string;
  submit: string;
}

/**
 * ZÁSTUPNÁ komponenta formuláře PINu hostů bez logiky: nic neodesílá ani neověřuje.
 * TODO(M8-7): ověření PINu (role `guest_pin`), omezení pokusů a odemknutí citlivých bloků.
 */
export function PinGate({ title, body, label, submit }: PinGateProps) {
  const id = useId();
  return (
    <form
      className="site-pin"
      aria-labelledby={`${id}-title`}
      onSubmit={(event) => event.preventDefault()}
    >
      <h3 id={`${id}-title`} className="site-h3">
        {title}
      </h3>
      <p className="site-muted">{body}</p>
      <div className="site-pin-row">
        <label htmlFor={`${id}-pin`} className="site-label">
          {label}
        </label>
        <input
          id={`${id}-pin`}
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          className="site-input"
        />
        <button type="submit" className="site-btn">
          {submit}
        </button>
      </div>
    </form>
  );
}
