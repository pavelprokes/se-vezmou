import { describe, expect, it } from "vitest";
import { parseArgs } from "./ops-bootstrap.mjs";

describe("ops-bootstrap: argumenty", () => {
  it("create-owner s e-mailem (malými písmeny, bez mezer)", () => {
    expect(parseArgs(["create-owner", " Majitel@Example.CZ "])).toMatchObject({
      command: "create-owner",
      email: "majitel@example.cz",
      allowAdditional: false,
    });
  });

  it("--allow-additional jen u create-owner", () => {
    expect(parseArgs(["create-owner", "a@b.cz", "--allow-additional"]).allowAdditional).toBe(true);
    expect(() => parseArgs(["reset-mfa", "a@b.cz", "--allow-additional"])).toThrow(
      "--allow-additional",
    );
  });

  it("odmítne chybějící nebo neplatný e-mail, neznámý příkaz a argument", () => {
    expect(() => parseArgs(["create-owner"])).toThrow("platný e-mail");
    expect(() => parseArgs(["create-owner", "neni-email"])).toThrow("platný e-mail");
    expect(() => parseArgs(["smaz-vse", "a@b.cz"])).toThrow("Neznámý příkaz");
    expect(() => parseArgs(["create-owner", "a@b.cz", "--force"])).toThrow("Neznámý argument");
    expect(() => parseArgs(["create-owner", "a@b.cz", "c@d.cz"])).toThrow("jen jeden e-mail");
  });

  it("nápověda nevyžaduje e-mail", () => {
    expect(parseArgs([]).help).toBe(true);
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["create-owner", "--help"]).help).toBe(true);
  });
});
