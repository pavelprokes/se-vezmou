// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShareLinks } from "./share-links";

const labels = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "E-mail",
  native: "Další možnosti",
  subject: "Svatební web",
  message: "Zveme vás: https://klara-a-matej.se-vezmou.cz",
};

describe("ShareLinks", () => {
  it("sestaví odkazy pro WhatsApp, SMS a e-mail se zakódovanou zprávou", () => {
    render(<ShareLinks labels={labels} />);
    const text = encodeURIComponent(labels.message);
    expect(screen.getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
      "href",
      `https://wa.me/?text=${text}`,
    );
    expect(screen.getByRole("link", { name: "SMS" })).toHaveAttribute("href", `sms:?&body=${text}`);
    expect(screen.getByRole("link", { name: "E-mail" })).toHaveAttribute(
      "href",
      `mailto:?subject=${encodeURIComponent("Svatební web")}&body=${text}`,
    );
  });

  it("systémové sdílení se nabídne jen tam, kde ho zařízení umí", () => {
    render(<ShareLinks labels={labels} />);
    expect(screen.queryByRole("button", { name: "Další možnosti" })).toBeNull();
  });
});
