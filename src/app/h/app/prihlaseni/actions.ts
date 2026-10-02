"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { appOrigin, currentHostConfig } from "@/auth/app-origin";
import { PENDING_LOGIN_SECONDS } from "@/auth/config";
import { cookieSpec, expiredCookieSpec } from "@/auth/cookie";
import { normalizeEmail, parseCode, parseSlug } from "@/auth/identity";
import {
  openLoginLink,
  openPendingLogin,
  requestLoginCode,
  sealPendingLogin,
  verifyLoginCode,
  type Defer,
  type VerifyCodeResult,
} from "@/auth/login";
import { normalizePinInput } from "@/auth/pin";
import { loginWithPin } from "@/auth/pin-login";
import { assertSameOrigin, getClientIp, getHost, getUiLocale } from "@/auth/request";
import { endSession, startAdminSession } from "@/auth/session";
import { formatPause } from "@/i18n/duration";

/**
 * Server Actions přihlášení. Každá začíná kontrolou původu (CSRF) a sama si ověřuje, co potřebuje:
 * proxy není bezpečnostní hranice (docs/adr/0002). Odpovědi nikdy neprozradí, zda e-mail, adresa
 * webu nebo účet existují.
 */

export type FormState = {
  /** Kód chyby; text zvolí formulář podle jazyka. */
  error?:
    "invalid_email" | "limited" | "generic" | "expired" | "format" | "wrong" | "invalid" | "locked";
  /** Zadaná hodnota, aby se po chybě nemusela psát znovu (nikdy PIN ani kód). */
  value?: string;
  /** U `locked`: pauza slovy ("15 minut"). */
  pause?: string;
} | null;

const defer: Defer = (task) =>
  after(async () => {
    await task();
  });

async function originAllowed(): Promise<boolean> {
  try {
    await assertSameOrigin();
    return true;
  } catch {
    return false;
  }
}

async function clearPending(): Promise<void> {
  const expired = expiredCookieSpec("pending", await getHost());
  (await cookies()).set({ name: expired.name, value: expired.value, ...expired.options });
}

/** 1. krok: e-mail -> kód do schránky. Odpověď je stejná pro známý i neznámý e-mail. */
export async function requestCodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await originAllowed())) return { error: "generic" };

  const raw = formData.get("email");
  const email = normalizeEmail(raw);
  if (!email) return { error: "invalid_email", value: typeof raw === "string" ? raw : "" };

  const host = await getHost();
  const result = await requestLoginCode({
    email,
    ip: await getClientIp(),
    locale: await getUiLocale(),
    origin: appOrigin(host, currentHostConfig()),
    defer,
  });
  if (result.status === "limited") return { error: "limited", value: email };

  // Rozpracované přihlášení patří prohlížeči, který kód vyžádal (zapečetěný e-mail, 10 minut).
  const spec = cookieSpec("pending", host, PENDING_LOGIN_SECONDS);
  (await cookies()).set({ name: spec.name, value: sealPendingLogin(email), ...spec.options });
  redirect("/prihlaseni/kod");
}

async function finish(result: VerifyCodeResult): Promise<FormState> {
  switch (result.status) {
    case "limited":
      return { error: "limited" };
    case "invalid":
      return { error: "wrong" };
    case "ok":
      await startAdminSession(result.weddingId, result.adminId);
      await clearPending();
      redirect("/");
  }
}

/** 2. krok: šestimístný kód (vložený nebo opsaný) -> relace. */
export async function verifyCodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await originAllowed())) return { error: "generic" };

  const store = await cookies();
  const pending = store.get(cookieSpec("pending", await getHost()).name)?.value;
  const email = pending ? openPendingLogin(pending) : null;
  if (!email) return { error: "expired" };

  const code = parseCode(formData.get("code"));
  if (!code) return { error: "format" };

  return finish(await verifyLoginCode({ email, code, ip: await getClientIp() }));
}

/** Potvrzení odkazu z e-mailu (odkaz sám nepřihlašuje, až toto odeslání formuláře). */
export async function confirmLinkAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await originAllowed())) return { error: "generic" };

  const token = formData.get("t");
  const opened = typeof token === "string" ? openLoginLink(token) : null;
  if (!opened) return { error: "wrong" };

  return finish(await verifyLoginCode({ ...opened, ip: await getClientIp() }));
}

/** Přihlášení PINem správy: adresa webu + PIN. Každé přihlášení se oznámí na záložní e-mail. */
export async function pinLoginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await originAllowed())) return { error: "generic" };

  const rawSlug = formData.get("slug");
  const rawPin = formData.get("pin");
  const locale = await getUiLocale();
  const result = await loginWithPin({
    slug: parseSlug(rawSlug),
    pin: typeof rawPin === "string" ? normalizePinInput(rawPin) : "",
    ip: await getClientIp(),
    locale,
    origin: appOrigin(await getHost(), currentHostConfig()),
    defer,
  });

  switch (result.status) {
    case "ok":
      await startAdminSession(result.weddingId, result.adminId);
      redirect("/");
    case "locked":
      return {
        error: "locked",
        value: typeof rawSlug === "string" ? rawSlug : "",
        pause: formatPause(result.retryAfter, locale),
      };
    case "limited":
      return { error: "limited", value: typeof rawSlug === "string" ? rawSlug : "" };
    case "invalid":
      return { error: "invalid", value: typeof rawSlug === "string" ? rawSlug : "" };
  }
}

/** Odhlášení: relace se odvolá na serveru a cookie zanikne. */
export async function logoutAction(): Promise<void> {
  if (await originAllowed()) {
    await endSession();
  }
  redirect("/prihlaseni");
}
