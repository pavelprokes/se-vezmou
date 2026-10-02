import { describe, expect, it } from "vitest";
import { poolConfigFromUrl, resolveDatabaseUrl, tlsFromUrl, POOL_MAX } from "./pool";

const POOLER =
  "postgresql://se_vezmou_app.projektref:p%40ss@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";

describe("adresa databáze", () => {
  it("DATABASE_URL má přednost", () => {
    expect(
      resolveDatabaseUrl({ DATABASE_URL: "postgres://a@h/db", SUPABASE_URL: "postgres://b@h/db" }),
    ).toBe("postgres://a@h/db");
  });

  it("SUPABASE_URL je záložní jen pokud je to postgres(ql):// adresa, https adresa se ignoruje", () => {
    expect(resolveDatabaseUrl({ SUPABASE_URL: "postgresql://b@h/db" })).toBe("postgresql://b@h/db");
    expect(resolveDatabaseUrl({ SUPABASE_URL: "https://projekt.supabase.co" })).toBeUndefined();
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });
});

describe("nastavení poolu", () => {
  it("pooler Supabase: malý max, timeouty, rozbalené heslo", () => {
    const config = poolConfigFromUrl(POOLER, {});
    expect(config).toMatchObject({
      host: "aws-0-eu-central-1.pooler.supabase.com",
      port: 6543,
      user: "se_vezmou_app.projektref",
      password: "p@ss",
      database: "postgres",
      max: POOL_MAX,
    });
    expect(POOL_MAX).toBeLessThanOrEqual(5);
    expect(config.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(config.statement_timeout).toBeGreaterThan(0);
    expect(config.idleTimeoutMillis).toBeGreaterThan(0);
  });

  it("nevalidní nebo cizí adresa se odmítne zprávou bez hesla", () => {
    expect(() => poolConfigFromUrl("https://x.supabase.co", {})).toThrow(/postgres/);
    expect(() => poolConfigFromUrl("tohle neni url", {})).toThrow(/DATABASE_URL/);
    let message = "";
    try {
      poolConfigFromUrl("mysql://u:tajneheslo@h/db", {});
    } catch (error) {
      message = String(error);
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("tajneheslo");
  });

  it("unixový socket (lokální e2e): host z parametru, bez TLS", () => {
    const config = poolConfigFromUrl("postgresql://se_vezmou_app@/postgres?host=/tmp/sock", {});
    expect(config).toMatchObject({ host: "/tmp/sock", user: "se_vezmou_app", ssl: false });
  });
});

describe("TLS", () => {
  const tls = (url: string, env: Record<string, string> = {}) => tlsFromUrl(new URL(url), env);

  it("vzdálená databáze: výchozí je TLS bez ověření řetězu (require)", () => {
    expect(tls(POOLER)).toEqual({ rejectUnauthorized: false });
    expect(tls(`${POOLER}?sslmode=require`)).toEqual({ rejectUnauthorized: false });
  });

  it("s DATABASE_CA_CERT se certifikát ověřuje", () => {
    expect(tls(POOLER, { DATABASE_CA_CERT: "PEM" })).toEqual({
      ca: "PEM",
      rejectUnauthorized: true,
    });
    expect(tls(`${POOLER}?sslmode=verify-full`)).toEqual({ rejectUnauthorized: true });
  });

  it("loopback je bez TLS, ale vzdálená databáze bez TLS se odmítne", () => {
    expect(tls("postgresql://u@localhost:5432/postgres")).toBe(false);
    expect(() => tls(`${POOLER}?sslmode=disable`)).toThrow(/lokální/);
    expect(() => tls(`${POOLER}?sslmode=blabla`)).toThrow(/sslmode/);
  });
});
