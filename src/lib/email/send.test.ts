import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AUTH_SECRET = "auth-secret-auth-secret-auth-secret-1";
});

import { setTransport } from "@/lib/db/rpc";
import { sendTemplatedEmail } from "./send";

const EMAIL = { subject: "Upozornění", html: "<p>x</p>", text: "x" };

function fakeDb() {
  const statuses: string[] = [];
  setTransport({
    async call(fn, args) {
      if (fn === "email_log_insert") return "55555555-5555-4555-8555-555555555555";
      if (fn === "email_log_set_status") {
        statuses.push(String(args.p_status));
        return true;
      }
      throw new Error(`Neočekávané volání ${fn}`);
    },
  });
  return statuses;
}

const input = (requireDelivery?: boolean) => ({
  type: "expiry_notice" as const,
  to: "par@example.test",
  weddingId: "11111111-1111-4111-8111-111111111111",
  locale: "cs" as const,
  email: EMAIL,
  secret: "s".repeat(32),
  requireDelivery,
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => setTransport(null));

describe("sendTemplatedEmail přes konzolovou dopravu (vývoj bez SES)", () => {
  it("běžná zpráva (přihlašovací kód) projde konzolí", async () => {
    const statuses = fakeDb();
    expect(await sendTemplatedEmail(input())).toBe(true);
    expect(statuses).toEqual(["sent"]);
  });

  it("zpráva, která musí odejít (upozornění na smazání), konzolí neprojde a eviduje se jako failed", async () => {
    const statuses = fakeDb();
    expect(await sendTemplatedEmail(input(true))).toBe(false);
    expect(statuses).toEqual(["failed"]);
  });
});
