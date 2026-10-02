import "server-only";
import { headers } from "next/headers";
import type { Locale } from "@/i18n/config";
import { clientIp, isSameOrigin, pickLocale } from "./request-info";

/** Údaje o aktuálním požadavku ze Server Components a Server Actions. */

export async function getClientIp(): Promise<string> {
  const h = await headers();
  return clientIp((name) => h.get(name), Boolean(process.env.VERCEL));
}

export async function getHost(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-host")?.split(",")[0]?.trim() ?? h.get("host");
}

/** Jazyk rozhraní správy (cs výchozí, en podle `Accept-Language`). */
export async function getUiLocale(): Promise<Locale> {
  return pickLocale((await headers()).get("accept-language"));
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
