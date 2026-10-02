"use client";

import { useSyncExternalStore } from "react";
import WizardApp, { type WizardAppProps } from "./wizard-app";

const subscribe = () => () => {};

/**
 * Průvodce se vykresluje jen v prohlížeči: koncept je v localStorage (bez účtu), takže ho server
 * nezná a nedává smysl ho vykreslovat dvakrát. Server pošle rám stránky, nadpis a zprávu
 * o načítání; po hydrataci se místo ní objeví průvodce (bez neshody mezi serverem a prohlížečem).
 */
export function WizardLoader(props: WizardAppProps) {
  const inBrowser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!inBrowser) {
    return (
      <p role="status" className="mx-auto w-full max-w-3xl px-4 py-8" data-testid="wizard-loading">
        {props.messages["wizard.loading"] as string}
      </p>
    );
  }
  return <WizardApp {...props} />;
}
