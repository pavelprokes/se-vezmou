import { describe, expect, it } from "vitest";
import { cookieSpec, expiredCookieSpec, isLocalHost } from "./cookie";

describe("cookieSpec (ostrý provoz)", () => {
  const spec = cookieSpec("admin", "app.se-vezmou.cz", 3600);

  it("má prefix __Host-", () => {
    expect(spec.name).toBe("__Host-sv_admin");
  });

  it("splňuje požadavky prefixu __Host-: Secure, Path=/ a žádný Domain", () => {
    expect(spec.options.secure).toBe(true);
    expect(spec.options.path).toBe("/");
    expect(spec.options).not.toHaveProperty("domain");
  });

  it("je HttpOnly a SameSite=Lax", () => {
    expect(spec.options.httpOnly).toBe(true);
    expect(spec.options.sameSite).toBe("lax");
  });

  it("nese maxAge jen když je zadán", () => {
    expect(spec.options.maxAge).toBe(3600);
    expect(cookieSpec("admin", "app.se-vezmou.cz").options).not.toHaveProperty("maxAge");
  });

  it("rozpracované přihlášení má vlastní název, ale stejné atributy", () => {
    const pending = cookieSpec("pending", "app.se-vezmou.cz", 600);
    expect(pending.name).toBe("__Host-sv_login");
    expect(pending.options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });
  });

  it("cookie průvodce má vlastní název a stejné atributy", () => {
    const wizard = cookieSpec("wizard", "app.se-vezmou.cz", 1800);
    expect(wizard.name).toBe("__Host-sv_wizard");
    expect(wizard.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 1800,
    });
    expect(cookieSpec("wizard", "app.localhost:3100").name).toBe("sv_wizard");
  });

  it("relace hosta po PINu a lístek RSVP: __Host-, host-only a bez Domain jako ostatní", () => {
    const guest = cookieSpec("guest", "klara-a-matej.se-vezmou.cz", 172_800);
    expect(guest.name).toBe("__Host-sv_guest");
    expect(guest.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    expect(guest.options).not.toHaveProperty("domain");
    const rsvp = cookieSpec("rsvp", "klara-a-matej.se-vezmou.cz", 1800);
    expect(rsvp.name).toBe("__Host-sv_rsvp");
    expect(rsvp.options).toMatchObject({ httpOnly: true, secure: true, maxAge: 1800 });
    expect(rsvp.options).not.toHaveProperty("domain");
    // lokálně bez prefixu a bez Secure, ale pořád HttpOnly a bez Domain
    expect(cookieSpec("guest", "klara-a-matej.localhost:3100").name).toBe("sv_guest");
    expect(cookieSpec("rsvp", "klara-a-matej.localhost:3100").options.secure).toBe(false);
    // názvy cookie správce, hosta a lístku se nesmí shodovat
    const names = (["admin", "pending", "guest", "rsvp"] as const).map(
      (kind) => cookieSpec(kind, "klara-a-matej.se-vezmou.cz").name,
    );
    expect(new Set(names).size).toBe(4);
  });

  it("neznámý nebo chybějící hostitel se bere jako ostrý (přísná varianta)", () => {
    expect(cookieSpec("admin", null).name).toBe("__Host-sv_admin");
    expect(cookieSpec("admin", undefined).options.secure).toBe(true);
    expect(cookieSpec("admin", "localhost.se-vezmou.cz").name).toBe("__Host-sv_admin");
    expect(cookieSpec("admin", "evil-localhost").name).toBe("__Host-sv_admin");
  });
});

describe("cookieSpec (localhost)", () => {
  it.each(["localhost", "localhost:3000", "app.localhost:3100", "APP.LOCALHOST"])(
    "%s: bez prefixu a bez Secure, ale pořád HttpOnly, Lax a bez Domain",
    (host) => {
      const spec = cookieSpec("admin", host);
      expect(spec.name).toBe("sv_admin");
      expect(spec.options.secure).toBe(false);
      expect(spec.options.httpOnly).toBe(true);
      expect(spec.options.sameSite).toBe("lax");
      expect(spec.options).not.toHaveProperty("domain");
    },
  );
});

describe("isLocalHost", () => {
  it("pozná localhost a poddomény, nic jiného", () => {
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("app.localhost:3000")).toBe(true);
    expect(isLocalHost("app.se-vezmou.cz")).toBe(false);
    expect(isLocalHost("localhost.evil.cz")).toBe(false);
    expect(isLocalHost("")).toBe(false);
    expect(isLocalHost(null)).toBe(false);
  });
});

describe("expiredCookieSpec", () => {
  it("má stejný název a atributy jako původní cookie a maxAge 0", () => {
    const expired = expiredCookieSpec("admin", "app.se-vezmou.cz");
    expect(expired).toMatchObject({ name: "__Host-sv_admin", value: "" });
    expect(expired.options).toMatchObject({
      maxAge: 0,
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  });
});
