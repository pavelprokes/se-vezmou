import "server-only";
import { headers } from "next/headers";
import { env } from "@/env";
import { UI_LOCALE_HEADER } from "@/host/ui-locale";
import type { Locale } from "@/i18n/config";
import { clientIp, isSameOrigin, pickLocale } from "./request-info";

/** Údaje o aktuálním požadavku ze Server Components a Server Actions. */

export async function getClientIp(): Promise<string> {
  const h = await headers();
  return clientIp((name) => h.get(name), Boolean(env.VERCEL));
}

export async function getHost(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-host")?.split(",")[0]?.trim() ?? h.get("host");
}

/**
 * Jazyk rozhraní správy: `/en/...` na hostiteli `app.` (hlavičku nastavuje proxy a klientem
 * poslanou hodnotu přepisuje), jinak čeština, angličtina podle `Accept-Language`.
 */
export async function getUiLocale(): Promise<Locale> {
  const h = await headers();
  const fromRoute = h.get(UI_LOCALE_HEADER);
  if (fromRoute === "en" || fromRoute === "cs") return fromRoute;
  return pickLocale(h.get("accept-language"));
}

export class OriginError extends Error {
  constructor() {
    super("Neplatný původ požadavku");
    this.name = "OriginError";
  }
}

/** Každá mutace (Server Action) začíná touto kontrolou (CSRF, docs/security-privacy.md kap. 2). */
export async function assertSameOrigin(): Promise<void> {
  const h = await headers();
  if (!isSameOrigin(h.get("origin"), h.get("host"), h.get("x-forwarded-host"))) {
    throw new OriginError();
  }
}
