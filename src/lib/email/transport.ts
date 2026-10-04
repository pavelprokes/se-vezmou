import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "@/env";
import { isProductionLike, testHatchesAllowed } from "@/lib/test-hatches";

/**
 * Doprava e-mailů (docs/adr/0005-email.md). Volající a šablony na poskytovateli nezávisejí:
 *
 * - `ses`: AWS SES v2 (vybere se, když jsou nastaveny AWS_REGION, přístupové klíče a EMAIL_FROM),
 * - `console`: bez AWS proměnných se e-mail jen vypíše do konzole a neodešle (jen vývoj a testy
 *   jednotek). V produkčním sestavení (`NODE_ENV=production` nebo `VERCEL_ENV=production`) bez SES
 *   `getEmailTransport` vyhodí chybu, takže se selhání projeví jako `failed`/`partial` a e-mail se
 *   nikdy neoznačí jako odeslaný,
 * - `outbox`: jen automatické testy (`EMAIL_TRANSPORT=outbox`); e-maily se zapisují jako soubory
 *   JSON do EMAIL_OUTBOX_DIR. V produkčním sestavení je odmítnuta bez `ALLOW_TEST_HATCHES=1`, v ostré produkci vždy.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Obrázky vložené přes Content-ID (`cid:`). */
  inline?: { cid: string; contentType: string; content: Uint8Array }[];
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
      JSON.stringify({
        ...message,
        inline: message.inline?.map((i) => ({
          ...i,
          content: Buffer.from(i.content).toString("base64"),
        })),
        id,
        sentAt: new Date().toISOString(),
      }),
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
    // Testovací vrátka (src/lib/test-hatches.ts): v produkčním sestavení jen s ALLOW_TEST_HATCHES=1.
    if (!testHatchesAllowed(env)) {
      throw new Error("EMAIL_TRANSPORT=outbox není v produkčním sestavení povolen");
    }
    return outboxTransport;
  }
  if (wanted === "console") {
    // Konzole e-mail neodešle. V produkčním sestavení by to znamenalo tiché „odeslání“ (záznam `sent`
    // bez doručení, třeba upozornění na smazání), proto je tam chyba, stejně jako u outboxu.
    if (isProductionLike(env)) {
      throw new Error(
        "E-mail nelze odeslat: v produkčním sestavení chybí nastavení AWS SES " +
          "(AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, EMAIL_FROM).",
      );
    }
    return consoleTransport;
  }
  if (!hasAwsConfig()) {
    throw new Error("EMAIL_TRANSPORT=ses vyžaduje AWS_REGION, přístupové klíče a EMAIL_FROM");
  }
  const { createSesTransport } = await import("./ses");
  return createSesTransport();
}

/** Odešle zprávu zvolenou dopravou. Šablony a záznam e-mailu (bez PII) řeší `send.ts`. */
export async function sendEmail(
  message: EmailMessage,
  options: { requireDelivery?: boolean } = {},
): Promise<SendResult> {
  const transport = await getEmailTransport();
  // Zprávy, jejichž odeslání se eviduje jako splněná povinnost (upozornění na smazání), nikdy neprojdou
  // konzolí: ta nic nedoručí, a tedy nesmí vést k záznamu „odesláno“.
  if (options.requireDelivery && transport.name === "console") {
    throw new Error("E-mail nelze doručit: je zvolena konzolová doprava");
  }
  return transport.send(message);
}
