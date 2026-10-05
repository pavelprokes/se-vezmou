// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { testimonials } from "@/config/testimonials";
import { TestimonialsSection } from "./testimonials-section";

const sample = {
  id: "klara-a-matej-2027",
  couple: "Klára a Matěj",
  weddingMonth: "2027-06",
  quote: { cs: "Hosté se nás už na nic neptali." },
  consentOn: "2027-07-01",
};

describe("TestimonialsSection", () => {
  it("bez recenzí se nevykreslí", async () => {
    expect(await TestimonialsSection({ locale: "cs", items: [] })).toBeNull();
  });

  it("ukáže citát, podpis, měsíc svatby a větu o ověření", async () => {
    render(await TestimonialsSection({ locale: "cs", items: [sample] }));
    expect(screen.getByRole("heading", { name: "Co říkají páry" })).toBeInTheDocument();
    expect(screen.getByText("Hosté se nás už na nic neptali.")).toBeInTheDocument();
    expect(screen.getByText("Svatba, červen 2027")).toBeInTheDocument();
    expect(screen.getByText(/ověřujeme podle existence jejich webu/)).toBeInTheDocument();
  });

  it("citát bez překladu označí jazykem originálu", async () => {
    render(await TestimonialsSection({ locale: "en", items: [sample] }));
    expect(
      screen.getByText("Hosté se nás už na nic neptali.").closest("blockquote"),
    ).toHaveAttribute("lang", "cs");
  });
});

describe("config/testimonials", () => {
  it("každá reference má souhlas, měsíc svatby a citát", () => {
    for (const item of testimonials) {
      expect(item.consentOn, item.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.weddingMonth, item.id).toMatch(/^\d{4}-\d{2}$/);
      expect(
        Object.values(item.quote).some((text) => text?.trim()),
        item.id,
      ).toBe(true);
    }
  });
});
