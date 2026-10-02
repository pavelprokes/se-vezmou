import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "@/env";

/**
 * Doprava e-mailů (docs/adr/0005-email.md). Volající a šablony na poskytovateli nezávisejí:
 *
 * - `ses`: AWS SES v2 (vybere se, když jsou nastaveny AWS_REGION, přístupové klíče a EMAIL_FROM),
 * - `console`: bez AWS proměnných se e-mail jen vypíše do konzole a neodešle (vývoj). V produkčním
 *   sestavení se nikdy nevypisuje obsah (přihlašovací kód by skončil v záznamech serveru),
 * - `outbox`: jen automatické testy (`EMAIL_TRANSPORT=outbox`); e-maily se zapisují jako soubory
 *   JSON do EMAIL_OUTBOX_DIR. V ostré produkci je odmítnuta.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};

export type SendResult = { providerMessageId?: string };

export interface EmailTransport {
  readonly name: "ses" | "console" | "outbox";
  send(message: EmailMessage): Promise<SendResult>;
}

const consoleTransport: EmailTransport = {
  name: "console",
  async send(message) {
    if (process.env.NODE_ENV === "development") {
      console.info(
        [
          "[e-mail] AWS SES není nastaveno, e-mail se neodesílá. Obsah (jen vývoj):",
          `Komu: ${message.to}`,
          `Předmět: ${message.subject}`,
          "",
          message.text,
        ].join("\n"),
      );
    } else {
      console.warn("[e-mail] AWS SES není nastaveno, e-mail se neodeslal (obsah se nevypisuje).");
    }
    return {};
  },
};

const outboxTransport: EmailTransport = {
  name: "outbox",
  async send(message) {
    const dir = env.EMAIL_OUTBOX_DIR;
    if (!dir) throw new Error("EMAIL_OUTBOX_DIR není nastaven");
    await mkdir(dir, { recursive: true });
    const id = randomUUID();
    // Název řadí soubory podle času odeslání; test čte nejnovější zprávu pro příjemce.
    await writeFile(
      join(dir, `${Date.now()}-${id}.json`),
      JSON.stringify({ ...message, id, sentAt: new Date().toISOString() }),
    );
    return { providerMessageId: id };
  },
};

function hasAwsConfig(): boolean {
  return Boolean(
    env.AWS_REGION && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.EMAIL_FROM,
  );
}

export async function getEmailTransport(): Promise<EmailTransport> {
  const wanted = env.EMAIL_TRANSPORT ?? (hasAwsConfig() ? "ses" : "console");
  if (wanted === "outbox") {
    if (process.env.VERCEL_ENV === "production") {
      throw new Error("EMAIL_TRANSPORT=outbox není v produkci povolen");
    }
    return outboxTransport;
  }
  if (wanted === "console") return consoleTransport;
  const { createSesTransport } = await import("./ses");
  return createSesTransport();
}

/** Odešle zprávu zvolenou dopravou. Šablony a záznam e-mailu (bez PII) řeší `send.ts`. */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  return (await getEmailTransport()).send(message);
}
