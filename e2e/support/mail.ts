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

/** Aplikace soubor zapisuje průběžně: nedopsaný soubor (prázdný, useknutý JSON) se krátce zkouší znovu. */
function readMail(path: string): Mail {
  for (let attempt = 0; ; attempt++) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Mail;
    } catch (error) {
      if (attempt >= 50) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

export function readMails(to: string): Mail[] {
  let files: string[];
  try {
    files = readdirSync(outboxDir()).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  return files
    .sort()
    .map((name) => readMail(join(outboxDir(), name)))
    .filter((mail) => mail.to === to);
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
