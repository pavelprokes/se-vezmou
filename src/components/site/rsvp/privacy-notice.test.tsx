// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getTranslator } from "@/i18n/load";
import { RsvpPrivacyNotice } from "./privacy-notice";

const cs = await getTranslator("cs", ["common", "site", "rsvp"]);
const en = await getTranslator("en", ["common", "site", "rsvp"]);

describe("RsvpPrivacyNotice", () => {
  it("označí snoubence jako správce bez skládání jmen do věty a odkazuje na české zásady", () => {
    render(<RsvpPrivacyNotice t={cs} locale="cs" />);
    const notice = screen.getByTestId("rsvp-privacy-notice");
    // typo() vkládá nezlomitelné mezery za jednopísmenné předložky
    expect(notice.textContent?.replace(/\u00a0/g, " ")).toContain(
      "Správci údajů jsou snoubenci uvedení v záhlaví webu",
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toMatch(/^https?:\/\/[^/]+\/soukromi$/);
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("v angličtině odkazuje na anglické zásady", () => {
    render(<RsvpPrivacyNotice t={en} locale="en" />);
    expect(screen.getByRole("link").getAttribute("href")).toMatch(/\/en\/privacy$/);
    expect(screen.getByTestId("rsvp-privacy-notice").textContent).toContain("controller");
  });
});
