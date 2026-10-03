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
    "ALLOW_TEST_HATCHES",
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

  it("mimo vývoj (test) obsah nikdy nevypíše (kód by skončil v záznamech serveru)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { sendEmail } = await loadTransport({ NODE_ENV: "test" });
    await sendEmail(MESSAGE);
    const output = JSON.stringify([...info.mock.calls, ...warn.mock.calls, ...log.mock.calls]);
    expect(output).not.toContain("048213");
    expect(output).not.toContain("klara@example.cz");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("zpráva, která musí odejít, konzolí neprojde", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { sendEmail } = await loadTransport({ NODE_ENV: "development" });
    await expect(sendEmail(MESSAGE, { requireDelivery: true })).rejects.toThrow(/konzol/);
  });
});

describe("produkční sestavení bez SES", () => {
  it.each([
    ["VERCEL_ENV=production", { VERCEL_ENV: "production" }],
    ["NODE_ENV=production (mimo Vercel)", { NODE_ENV: "production" }],
  ])("bez AWS nastavení se doprava nevybere a odeslání selže (%s)", async (_label, env) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getEmailTransport, sendEmail } = await loadTransport(env);
    await expect(getEmailTransport()).rejects.toThrow(/SES/);
    await expect(sendEmail(MESSAGE)).rejects.toThrow(/SES/);
    expect(warn).not.toHaveBeenCalled();
  });

  it("s neúplným AWS nastavením také selže", async () => {
    const { getEmailTransport } = await loadTransport({
      NODE_ENV: "production",
      AWS_REGION: "eu-central-1",
    });
    await expect(getEmailTransport()).rejects.toThrow(/SES/);
  });

  it("výslovné EMAIL_TRANSPORT=console v produkci také selže", async () => {
    const { getEmailTransport } = await loadTransport({
      NODE_ENV: "production",
      EMAIL_TRANSPORT: "console",
    });
    await expect(getEmailTransport()).rejects.toThrow(/SES/);
  });

  it("s kompletním AWS nastavením se zvolí SES", async () => {
    const { getEmailTransport } = await loadTransport({ ...AWS, VERCEL_ENV: "production" });
    expect((await getEmailTransport()).name).toBe("ses");
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

  it("v produkčním sestavení bez ALLOW_TEST_HATCHES=1 se odmítne", async () => {
    const { getEmailTransport } = await loadTransport({
      EMAIL_TRANSPORT: "outbox",
      EMAIL_OUTBOX_DIR: "/tmp/x",
      NODE_ENV: "production",
    });
    await expect(getEmailTransport()).rejects.toThrow(/produkčním sestavení/);
  });

  it("v produkčním sestavení s ALLOW_TEST_HATCHES=1 (e2e) funguje", async () => {
    const { getEmailTransport } = await loadTransport({
      EMAIL_TRANSPORT: "outbox",
      EMAIL_OUTBOX_DIR: "/tmp/x",
      NODE_ENV: "production",
      ALLOW_TEST_HATCHES: "1",
    });
    expect((await getEmailTransport()).name).toBe("outbox");
  });

  it("v ostré produkci se odmítne i s ALLOW_TEST_HATCHES=1", async () => {
    const { getEmailTransport } = await loadTransport({
      EMAIL_TRANSPORT: "outbox",
      EMAIL_OUTBOX_DIR: "/tmp/x",
      VERCEL_ENV: "production",
      ALLOW_TEST_HATCHES: "1",
    });
    await expect(getEmailTransport()).rejects.toThrow(/produkčním sestavení/);
  });

  it("v ostré produkci se odmítne", async () => {
    const { getEmailTransport } = await loadTransport({
      EMAIL_TRANSPORT: "outbox",
      EMAIL_OUTBOX_DIR: "/tmp/x",
      VERCEL_ENV: "production",
    });
    await expect(getEmailTransport()).rejects.toThrow(/produkčním sestavení/);
  });

  it("bez adresáře selže", async () => {
    const { sendEmail } = await loadTransport({ EMAIL_TRANSPORT: "outbox" });
    await expect(sendEmail(MESSAGE)).rejects.toThrow(/EMAIL_OUTBOX_DIR/);
  });
});
