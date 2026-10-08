import { describe, expect, it } from "vitest";
import { previewSlug } from "./slug-preview";

describe("previewSlug", () => {
  it("česky spojuje jména spojkou a", () => {
    expect(previewSlug("Klára", "Matěj")).toBe("klara-a-matej");
  });

  it("anglicky spojuje jména spojkou and", () => {
    expect(previewSlug("Emma", "Thomas", "en")).toBe("emma-and-thomas");
  });

  it("bez obou jmen vrací null", () => {
    expect(previewSlug("!!!", "", "en")).toBeNull();
  });
});
