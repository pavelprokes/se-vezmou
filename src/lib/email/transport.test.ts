import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const MESSAGE = {
  to: "klara@example.cz",
  subject: "Přihlašovací kód",
  html: "<p>048213</p>",
  text: "Kód:\n048213\n",
};

const AWS = {
  AWS_REGION: "eu-central-1",
  AWS_ACCESS_KEY_ID: "AKIATEST",
  AWS_SECRET_ACCESS_KEY: "tajne",
  EMAIL_FROM: "Se vezmou <info@se-vezmou.cz>",
};

/** `env` se čte při importu, proto se modul pro každý test načte znovu. */
async function loadTransport(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const key of [
    ...Object.keys(AWS),
    "EMAIL_TRANSPORT",
    "EMAIL_OUTBOX_DIR",
    "VERCEL_ENV",
    "NODE_ENV",
  ]) {
    vi.stubEnv(key, "");
  }
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import("./transport");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("výběr dopravy", () => {
  it("bez AWS proměnných se e-mail jen vypíše do konzole a neodešle", async () => {
    const { getEmailTransport } = await loadTransport();
    expect((await getEmailTransport()).name).toBe("console");
  });

  it("s kompletními AWS proměnnými se zvolí SES", async () => {
    const { getEmailTransport } = await loadTransport(AWS);
    expect((await getEmailTransport()).name).toBe("ses");
  });

  it("s neúplnými AWS proměnnými se zvolí konzole", async () => {
    const { getEmailTransport } = await loadTransport({ AWS_REGION: "eu-central-1" });
    expect((await getEmailTransport()).name).toBe("console");
  });

  it("výslovná volba má přednost", async () => {
    const { getEmailTransport } = await loadTransport({ ...AWS, EMAIL_TRANSPORT: "console" });
    expect((await getEmailTransport()).name).toBe("console");
  });
});

describe("konzole (vývoj bez AWS)", () => {
  it("ve vývoji vypíše obsah včetně kódu", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { sendEmail } = await loadTransport({ NODE_ENV: "development" });
    await sendEmail(MESSAGE);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0][0])).toContain("048213");
  });

  it("mimo vývoj obsah nikdy nevypíše (kód by skončil v záznamech serveru)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { sendEmail } = await loadTransport({ NODE_ENV: "production" });
    await sendEmail(MESSAGE);
    const output = JSON.stringify([...info.mock.calls, ...warn.mock.calls, ...log.mock.calls]);
    expect(output).not.toContain("048213");
    expect(output).not.toContain("klara@example.cz");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("outbox (jen testy)", () => {
  it("zapíše e-mail jako soubor JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sevezmou-outbox-"));
    try {
      const { sendEmail } = await loadTransport({
        EMAIL_TRANSPORT: "outbox",
        EMAIL_OUTBOX_DIR: dir,
      });
      const result = await sendEmail(MESSAGE);
      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      const saved = JSON.parse(await readFile(join(dir, files[0]), "utf8"));
      expect(saved).toMatchObject(MESSAGE);
      expect(result.providerMessageId).toBe(saved.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("v ostré produkci se odmítne", async () => {
    const { getEmailTransport } = await loadTransport({
      EMAIL_TRANSPORT: "outbox",
      EMAIL_OUTBOX_DIR: "/tmp/x",
      VERCEL_ENV: "production",
    });
    await expect(getEmailTransport()).rejects.toThrow(/produkci/);
  });

  it("bez adresáře selže", async () => {
    const { sendEmail } = await loadTransport({ EMAIL_TRANSPORT: "outbox" });
    await expect(sendEmail(MESSAGE)).rejects.toThrow(/EMAIL_OUTBOX_DIR/);
  });
});
