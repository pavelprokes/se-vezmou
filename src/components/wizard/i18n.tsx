"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import { renderText, type MessageValue, type Params } from "@/i18n/format";
import type { MessageKey } from "@/i18n/messages";

/**
 * Překlady průvodce pro prohlížeč. Server pošle jen zprávy jmenného prostoru `wizard.*`
 * (`pickWizardMessages`), takže se do prohlížeče nenačtou všechny překlady webu. `t()` používá
 * stejnou interpolaci a typografii jako `createTranslator` (`renderText`); neexistující klíč
 * neprojde kontrolou typů a uživateli se klíč nikdy nezobrazí.
 */

export type WizardKey = Extract<MessageKey, `wizard.${string}`>;
export type WizardMessages = Record<string, MessageValue>;

export interface WizardT {
  (key: WizardKey, params?: Params): string;
  readonly locale: Locale;
}

const I18nContext = createContext<WizardT | null>(null);

export function createWizardT(locale: Locale, messages: WizardMessages): WizardT {
  const t = ((key: WizardKey, params?: Params) => {
    const value = messages[key];
    if (value === undefined) {
      console.error(`[i18n] Chybí překlad ${key} pro jazyk ${locale}`);
      return "";
    }
    return renderText(value, locale, params);
  }) as WizardT;
  Object.defineProperty(t, "locale", { value: locale, enumerable: true });
  return t;
}

export function WizardI18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: WizardMessages;
  children: ReactNode;
}) {
  const t = useMemo(() => createWizardT(locale, messages), [locale, messages]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

export function useT(): WizardT {
  const t = useContext(I18nContext);
  if (!t) throw new Error("useT mimo WizardI18nProvider");
  return t;
}
