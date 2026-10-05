import { beforeEach, describe, expect, it, vi } from "vitest";
import { backupConfirmUrl, openBackupConfirm } from "./backup-confirm";

const W = "3f1c2a90-1111-4222-8333-444455556666";

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "x".repeat(40));
});

const tokenOf = (url: string) => new URL(url).searchParams.get("t") ?? "";

describe("odkaz na potvrzení záložního e-mailu", () => {
  it("nese svatbu a adresu, jazyk v cestě", () => {
    const cs = backupConfirmUrl("https://app.se-vezmou.cz", "cs", W, "zaloha@example.test");
    expect(cs).toMatch(/^https:\/\/app\.se-vezmou\.cz\/potvrdit-email\?t=/);
    expect(openBackupConfirm(tokenOf(cs))).toEqual({ weddingId: W, email: "zaloha@example.test" });
    const en = backupConfirmUrl("https://app.se-vezmou.cz", "en", W, "zaloha@example.test");
    expect(new URL(en).pathname).toBe("/en/potvrdit-email");
  });

  it("prošlý nebo upravený odkaz neplatí", () => {
    const now = Date.now();
    const token = tokenOf(backupConfirmUrl("https://a", "cs", W, "z@example.test", now));
    expect(openBackupConfirm(token, now + 15 * 24 * 3600 * 1000)).toBeNull();
    expect(openBackupConfirm(`${token.slice(0, -2)}AA`)).toBeNull();
    expect(openBackupConfirm("nesmysl")).toBeNull();
  });
});
