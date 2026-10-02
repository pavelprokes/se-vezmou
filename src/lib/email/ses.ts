import "server-only";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { env } from "@/env";
import { sendEmail as sendWithSelectedTransport, type EmailTransport } from "./transport";

let client: SESv2Client | undefined;

/** Adaptér AWS SES v2 (region `eu-central-1`, docs/adr/0005-email.md). */
export function createSesTransport(): EmailTransport {
  return {
    name: "ses",
    async send({ to, subject, html, text, replyTo }) {
      if (!env.EMAIL_FROM) throw new Error("EMAIL_FROM není nastaven");
      client ??= new SESv2Client({ region: env.AWS_REGION });
      const result = await client.send(
        new SendEmailCommand({
          FromEmailAddress: env.EMAIL_FROM,
          Destination: { ToAddresses: [to] },
          ReplyToAddresses: replyTo ? [replyTo] : undefined,
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: "UTF-8" },
              Body: {
                Html: { Data: html, Charset: "UTF-8" },
                Text: { Data: text, Charset: "UTF-8" },
              },
            },
          },
        }),
      );
      return { providerMessageId: result.MessageId };
    },
  };
}

/** Zpětně kompatibilní vstup: odešle zprávu zvolenou dopravou (SES, jinak výpis do konzole). */
export const sendEmail = sendWithSelectedTransport;
