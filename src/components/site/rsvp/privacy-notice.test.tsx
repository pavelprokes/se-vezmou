// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createTranslator } from "@/i18n/translator";
import { RsvpPrivacyNotice } from "./privacy-notice";

describe("RsvpPrivacyNotice", () => {
  it("jmenuje pár jako správce a odkazuje na české zásady na hostiteli úvodní stránky", () => {
    render(
      <RsvpPrivacyNotice
        t={createTranslator("cs")}
        locale="cs"
        partners={{ a: "Klára", b: "Matěj" }}
      />,
    );
    const notice = screen.getByTestId("rsvp-privacy-notice");
    expect(notice.textContent).toContain("Klára");
    expect(notice.textContent).toContain("Matěj");
    expect(notice.textContent).toContain("správcem");
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toMatch(/^https?:\/\/[^/]+\/soukromi$/);
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("v angličtině odkazuje na anglické zásady", () => {
    render(
      <RsvpPrivacyNotice
        t={createTranslator("en")}
        locale="en"
        partners={{ a: "Klára", b: "Matěj" }}
      />,
    );
    expect(screen.getByRole("link").getAttribute("href")).toMatch(/\/en\/privacy$/);
    expect(screen.getByTestId("rsvp-privacy-notice").textContent).toContain("controller");
  });
});
