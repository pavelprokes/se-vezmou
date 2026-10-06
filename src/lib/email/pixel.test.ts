import { describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  NEXT_PUBLIC_SITE_URL: "https://se-vezmou.cz",
  UMAMI_PIXEL_URL: undefined as string | undefined,
}));
vi.mock("@/env", () => ({ env: mockEnv }));

import { buildPixelUrl } from "./pixel";
import {
  renderBackupLoginNotice,
  renderDeletionNotice,
  renderLoginCode,
  renderRetentionNotice,
  renderRsvpConfirmation,
  renderWizardCode,
} from "./templates";
import { composeEmail } from "./templates/shared";

const BASE = "https://analytics.example.cz/p/abc123xyz";

describe("buildPixelUrl", () => {
  it("bez nastavené adresy pixel nevznikne", () => {
    expect(buildPixelUrl(undefined, "smazani-upozorneni")).toBeNull();
    expect(buildPixelUrl("", "smazani-upozorneni")).toBeNull();
  });

  it("přidá jen pevné značky šablony", () => {
    const url = new URL(buildPixelUrl(BASE, "smazani-upozorneni")!);
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
    const url = new URL(buildPixelUrl(`${BASE}?email=a@b.cz#h`, "x")!);
    expect(url.searchParams.has("email")).toBe(false);
    expect(url.hash).toBe("");
    expect(buildPixelUrl("https://u:pw@analytics.example.cz/p/abc", "x")).not.toContain("pw");
    expect(buildPixelUrl("http://analytics.example.cz/p/abc", "x")).toBeNull();
    expect(buildPixelUrl("nesmysl", "x")).toBeNull();
  });
});

describe("pixel v e-mailu", () => {
  const pixel = buildPixelUrl(BASE, "smazani-upozorneni");

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

  it("bez pixelu e-mail žádný nenese", () => {
    const plain = composeEmail("cs", "Předmět", [{ kind: "paragraph", text: "Text" }], "Značka");
    expect(plain.html).not.toContain('width="1" height="1"');
  });

  it("kódy, bezpečnostní oznámení a e-maily hostům pixel nemají ani při nastavené proměnné", () => {
    mockEnv.UMAMI_PIXEL_URL = BASE;
    try {
      const link = "https://app.se-vezmou.cz/prihlaseni/odkaz?t=abc";
      const mails = [
        renderLoginCode({ locale: "cs", code: "048213", link, ttlSeconds: 600 }),
        renderWizardCode({ locale: "en", code: "731905", ttlSeconds: 600 }),
        renderBackupLoginNotice({
          locale: "cs",
          event: "pin_login",
          at: new Date("2026-10-02T12:05:00Z"),
          loginUrl: link,
        }),
        renderRsvpConfirmation({
          locale: "cs",
          partners: { a: "Klára", b: "Matěj" },
          people: [{ name: "Jan Novák", rows: [] }],
          editUrl: link,
          unlisted: false,
        }),
      ];
      for (const mail of mails) expect(mail.html).not.toContain('width="1" height="1"');
    } finally {
      mockEnv.UMAMI_PIXEL_URL = undefined;
    }
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
