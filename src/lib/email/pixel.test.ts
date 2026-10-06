import { describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  NEXT_PUBLIC_SITE_URL: "https://se-vezmou.cz",
  UMAMI_PIXEL_URL: undefined as string | undefined,
}));
vi.mock("@/env", () => ({ env: mockEnv }));

import { getEmailPixelUrl } from "./pixel";
import { renderDeletionNotice, renderRetentionNotice } from "./templates";
import { composeEmail } from "./templates/shared";

const BASE = "https://analytics.example.cz/p/abc123xyz";

describe("getEmailPixelUrl", () => {
  it("bez nastavené adresy pixel nevznikne", () => {
    expect(getEmailPixelUrl("smazani-upozorneni", undefined)).toBeNull();
    expect(getEmailPixelUrl("smazani-upozorneni", "")).toBeNull();
  });

  it("přidá jen pevné značky šablony", () => {
    const url = new URL(getEmailPixelUrl("smazani-upozorneni", BASE)!);
    expect(url.origin + url.pathname).toBe(BASE);
    expect([...url.searchParams.keys()].sort()).toEqual([
      "utm_content",
      "utm_medium",
      "utm_source",
    ]);
    expect(url.searchParams.get("utm_source")).toBe("se-vezmou");
    expect(url.searchParams.get("utm_medium")).toBe("email");
    expect(url.searchParams.get("utm_content")).toBe("smazani-upozorneni");
  });

  it("zahodí cizí parametry a fragment a odmítne ne-https", () => {
    const url = new URL(getEmailPixelUrl("x", `${BASE}?email=a@b.cz#h`)!);
    expect(url.searchParams.has("email")).toBe(false);
    expect(url.hash).toBe("");
    expect(getEmailPixelUrl("x", "http://analytics.example.cz/p/abc")).toBeNull();
    expect(getEmailPixelUrl("x", "nesmysl")).toBeNull();
  });
});

describe("pixel v e-mailu", () => {
  const pixel = getEmailPixelUrl("smazani-upozorneni", BASE);

  it("je jednou, na konci těla, jen v HTML a správně escapovaný", () => {
    const mail = composeEmail(
      "cs",
      "Předmět",
      [{ kind: "paragraph", text: "Text" }],
      "Značka",
      pixel,
    );
    const tag = mail.html.match(/<img src="https:\/\/analytics[^>]*>/g) ?? [];
    expect(tag).toHaveLength(1);
    expect(tag[0]).toContain("&amp;utm_medium=email");
    expect(tag[0]).not.toContain("&amp;amp;");
    expect(tag[0]).toContain('width="1" height="1" alt=""');
    expect(tag[0]).not.toMatch(/display:none|visibility:hidden/);
    expect(mail.html.trimEnd().endsWith(`${tag[0]}\n</body>\n</html>`)).toBe(true);
    expect(mail.text).not.toContain("analytics");
  });

  it("bez pixelu e-mail žádný nenese; přihlašovací a hostovské šablony ho nemají nikdy", () => {
    const plain = composeEmail("cs", "Předmět", [{ kind: "paragraph", text: "Text" }], "Značka");
    expect(plain.html).not.toContain('width="1" height="1"');
  });

  it("oznámení pro pár ho nesou jen s nastavenou proměnnou a s vlastním slugem", () => {
    const retention = {
      locale: "cs",
      kind: "site_expiry",
      stage: "first",
      eventAt: new Date("2027-07-12T10:00:00Z"),
      timeZone: "Europe/Prague",
      site: "klara-a-matej.se-vezmou.cz",
      exportUrl: "https://app.se-vezmou.cz/data",
    } as const;
    expect(renderRetentionNotice(retention).html).not.toContain('width="1" height="1"');
    mockEnv.UMAMI_PIXEL_URL = BASE;
    try {
      expect(renderRetentionNotice(retention).html).toContain("utm_content=smazani-upozorneni");
      expect(renderRetentionNotice(retention).text).not.toContain("analytics");
    } finally {
      mockEnv.UMAMI_PIXEL_URL = undefined;
    }
  });

  it("oznámení o zdravotních a hostových údajích pixel nemají nikdy", () => {
    mockEnv.UMAMI_PIXEL_URL = BASE;
    try {
      for (const kind of ["health_purge", "guest_purge"] as const) {
        const retention = renderRetentionNotice({
          locale: "cs",
          kind,
          stage: "first",
          eventAt: new Date("2027-07-12T10:00:00Z"),
          timeZone: "Europe/Prague",
          exportUrl: "https://app.se-vezmou.cz/data",
        });
        expect(retention.html).not.toContain('width="1" height="1"');
        const deletion = renderDeletionNotice({
          locale: "cs",
          kind,
          at: new Date("2027-07-12T10:00:00Z"),
          timeZone: "Europe/Prague",
          loginUrl: "https://app.se-vezmou.cz/prihlaseni",
        });
        expect(deletion.html).not.toContain('width="1" height="1"');
      }
      const site = renderDeletionNotice({
        locale: "cs",
        kind: "site_purge",
        at: new Date("2027-07-12T10:00:00Z"),
        timeZone: "Europe/Prague",
      });
      expect(site.html).toContain("utm_content=smazani-potvrzeni");
    } finally {
      mockEnv.UMAMI_PIXEL_URL = undefined;
    }
  });
});
