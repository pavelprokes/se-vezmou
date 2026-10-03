import "server-only";
import { emailDomain } from "@/auth/identity";
import { hmac } from "@/auth/crypto";
import type { Locale } from "@/i18n/config";
import { emailLogInsert, emailLogSetStatus, type EmailLogType } from "@/lib/db/rpc";
import { sendEmail } from "./transport";
import type { RenderedEmail } from "./templates";

/**
 * Odeslání šablonovaného e-mailu se záznamem do `email_log` bez osobních údajů
 * (docs/adr/0005-email.md): typ, jazyk, svatba, HMAC příjemce a jeho doména. Nikdy předmět, tělo,
 * kód ani celá adresa. Chyby se hlásí bez adresy.
 */

export type SendTemplatedInput = {
  type: EmailLogType;
  to: string;
  weddingId: string | null;
  locale: Locale;
  email: RenderedEmail;
  /** Tajná hodnota pro HMAC příjemce (AUTH_SECRET). */
  secret: string;
  /** Zpráva musí skutečně odejít (ne jen do konzole); jinak selže a eviduje se jako `failed`. */
  requireDelivery?: boolean;
};

/** Vrací `true`, když doprava zprávu přijala. Nikdy nevyhazuje: přihlášení na ní nesmí záviset. */
export async function sendTemplatedEmail(input: SendTemplatedInput): Promise<boolean> {
  let logId: string | null = null;
  try {
    logId = await emailLogInsert({
      type: input.type,
      weddingId: input.weddingId,
      locale: input.locale,
      recipientHash: hmac(input.secret, "email-log", input.to),
      recipientDomain: emailDomain(input.to),
    });
  } catch (error) {
    console.error("[e-mail] záznam e-mailu se nepodařilo uložit", errorName(error));
  }

  try {
    const result = await sendEmail(
      {
        to: input.to,
        subject: input.email.subject,
        html: input.email.html,
        text: input.email.text,
      },
      { requireDelivery: input.requireDelivery },
    );
    if (logId) {
      await emailLogSetStatus(logId, "sent", { providerMessageId: result.providerMessageId });
    }
    return true;
  } catch (error) {
    console.error("[e-mail] odeslání selhalo", input.type, errorName(error));
    if (logId) {
      await emailLogSetStatus(logId, "failed", { errorCode: errorName(error) }).catch(
        () => undefined,
      );
    }
    return false;
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
