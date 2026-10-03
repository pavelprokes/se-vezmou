import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clientConfig as rawClientConfig } from "./db-migrate.mjs";

const clientConfig = (url: string, env: Record<string, string>) =>
  rawClientConfig(url, env as NodeJS.ProcessEnv);

const REMOTE = "postgresql://postgres:heslo@db.projekt.supabase.co:5432/postgres";

describe("db-migrate: TLS", () => {
  it("vzdálená databáze bez CA se odmítne s jasnou zprávou, heslo se nevypíše", () => {
    let message = "";
    try {
      clientConfig(REMOTE, {});
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("MIGRATE_CA_CERT");
    expect(message).toContain("MIGRATE_TLS_INSECURE");
    expect(message).not.toContain("heslo");
  });

  it("s MIGRATE_CA_CERT se certifikát ověřuje", () => {
    expect(clientConfig(REMOTE, { MIGRATE_CA_CERT: "PEM" }).ssl).toEqual({
      ca: "PEM",
      rejectUnauthorized: true,
    });
  });

  it("MIGRATE_CA_CERT_FILE: certifikát se načte ze souboru (cesta relativně ke kořeni repa)", () => {
    const dir = mkdtempSync(join(tmpdir(), "migrate-ca-"));
    const file = join(dir, "ca.crt");
    writeFileSync(file, "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----\n");
    expect(clientConfig(REMOTE, { MIGRATE_CA_CERT_FILE: file }).ssl).toEqual({
      ca: "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----",
      rejectUnauthorized: true,
    });
    writeFileSync(file, "neni certifikat");
    expect(() => clientConfig(REMOTE, { MIGRATE_CA_CERT_FILE: file })).toThrow(
      /není certifikát PEM/,
    );
    expect(() => clientConfig(REMOTE, { MIGRATE_CA_CERT_FILE: join(dir, "chybi.crt") })).toThrow(
      /nejde přečíst/,
    );
  });

  it("výslovné MIGRATE_TLS_INSECURE=1 povolí TLS bez ověření; jiná hodnota ne", () => {
    expect(clientConfig(REMOTE, { MIGRATE_TLS_INSECURE: "1" }).ssl).toEqual({
      rejectUnauthorized: false,
    });
    expect(() => clientConfig(REMOTE, { MIGRATE_TLS_INSECURE: "yes" })).toThrow(/MIGRATE_CA_CERT/);
  });

  it("loopback a unixový socket fungují bez TLS (CI, lokální vývoj, e2e)", () => {
    expect(clientConfig("postgresql://postgres:x@localhost:5432/postgres", {}).ssl).toBe(false);
    expect(clientConfig("postgresql://postgres@/postgres?host=/tmp/sock", {}).ssl).toBe(false);
  });

  it("verify-full bez CA ověřuje podle systémových certifikátů", () => {
    expect(clientConfig(`${REMOTE}?sslmode=verify-full`, {}).ssl).toEqual({
      rejectUnauthorized: true,
    });
  });
});
