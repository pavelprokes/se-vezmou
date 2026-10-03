import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { outboxDir } from "./env";

/** Čtení e-mailů, které aplikace v testech zapsala do adresáře outbox místo odeslání. */

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  sentAt: string;
}

export function readMails(to: string): Mail[] {
  let files: string[];
  try {
    files = readdirSync(outboxDir()).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const mails: Mail[] = [];
  for (const name of files.sort()) {
    try {
      mails.push(JSON.parse(readFileSync(join(outboxDir(), name), "utf8")) as Mail);
    } catch {
      // Aplikace soubor právě zapisuje (nedopsaný JSON). Přeskočí se; `waitForMail` čte znovu za 100 ms.
    }
  }
  return mails.filter((mail) => mail.to === to);
}

/** Počká na `count`-tý e-mail pro adresu (e-mail se posílá až po odpovědi serveru). */
export async function waitForMail(to: string, count = 1, timeoutMs = 15_000): Promise<Mail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const mails = readMails(to);
    if (mails.length >= count) return mails[count - 1];
    if (Date.now() > deadline)
      throw new Error(`E-mail pro ${to} nedorazil (${mails.length}/${count})`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Šestimístný kód na vlastním řádku textové verze. */
export function codeOf(mail: Mail): string {
  const match = /^(\d{6})$/m.exec(mail.text);
  if (!match) throw new Error("V e-mailu není šestimístný kód");
  return match[1];
}

/** Odkaz z e-mailu (adresa na vlastním řádku textové verze). */
export function linkOf(mail: Mail): string {
  const match = /^(https?:\/\/\S+)$/m.exec(mail.text);
  if (!match) throw new Error("V e-mailu není odkaz");
  return match[1];
}

export async function expectNoMail(to: string, waitMs = 1500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  const mails = readMails(to);
  if (mails.length > 0)
    throw new Error(`E-mail pro ${to} nemá existovat, ale dorazilo ${mails.length}`);
}
