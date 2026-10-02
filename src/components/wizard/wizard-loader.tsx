"use client";

import { useSyncExternalStore } from "react";
import WizardApp, { type WizardAppProps } from "./wizard-app";

const subscribe = () => () => {};

/**
 * Průvodce se vykresluje jen v prohlížeči: koncept je v localStorage (bez účtu), takže ho server
 * nezná a nedává smysl ho vykreslovat dvakrát. Server pošle rám stránky, nadpis a zprávu
 * o načítání (a text pro prohlížeč bez JavaScriptu), vše v hlavní oblasti, na kterou míří odkaz přeskočení; po hydrataci se místo ní objeví průvodce (bez neshody mezi serverem a prohlížečem).
 */
export function WizardLoader({ noscript, ...props }: WizardAppProps & { noscript: string }) {
  const inBrowser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!inBrowser) {
    return (
      <main id="obsah" tabIndex={-1} className="mx-auto w-full max-w-3xl px-4 py-8">
        <p role="status" data-testid="wizard-loading">
          {props.messages["wizard.loading"] as string}
        </p>
        <noscript>
          <p className="mt-4">{noscript}</p>
        </noscript>
      </main>
    );
  }
  return <WizardApp {...props} />;
}
