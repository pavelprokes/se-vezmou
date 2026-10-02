"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import { renderText, type MessageValue, type Params } from "@/i18n/format";
import type { MessageKey } from "@/i18n/messages";

/**
 * Překlady správy pro prohlížeč. Server pošle jen zprávy jmenného prostoru `admin.*`
 * (`pickAdminMessages`), takže se do prohlížeče nenačtou všechny překlady webu. `t()` používá
 * stejnou interpolaci a typografii jako `createTranslator` (`renderText`); neexistující klíč
 * neprojde kontrolou typů a uživateli se klíč nikdy nezobrazí.
 */

export type AdminKey = Extract<MessageKey, `admin.${string}`>;
export type AdminMessages = Record<string, MessageValue>;

export interface AdminT {
  (key: AdminKey, params?: Params): string;
  readonly locale: Locale;
}

const I18nContext = createContext<AdminT | null>(null);

export function createAdminT(locale: Locale, messages: AdminMessages): AdminT {
  const t = ((key: AdminKey, params?: Params) => {
    const value = messages[key];
    if (value === undefined) {
      console.error(`[i18n] Chybí překlad ${key} pro jazyk ${locale}`);
      return "";
    }
    return renderText(value, locale, params);
  }) as AdminT;
  Object.defineProperty(t, "locale", { value: locale, enumerable: true });
  return t;
}

export function AdminI18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: AdminMessages;
  children: ReactNode;
}) {
  const t = useMemo(() => createAdminT(locale, messages), [locale, messages]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

export function useAdminT(): AdminT {
  const t = useContext(I18nContext);
  if (!t) throw new Error("useAdminT mimo AdminI18nProvider");
  return t;
}
