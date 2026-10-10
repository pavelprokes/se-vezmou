import { describe, expect, it } from "vitest";
import { parseGallerySignOptions } from "./server";

const from = (values: Record<string, string>) => (key: string) => values[key];

describe("parseGallerySignOptions", () => {
  it("výchozí: 10 × 15, text pro nahrávání, oba jazyky", () => {
    expect(parseGallerySignOptions(from({}))).toEqual({
      format: "frame",
      variant: "upload",
      language: "both",
    });
  });

  it("české hodnoty z adresy", () => {
    expect(
      parseGallerySignOptions(from({ format: "a5", text: "prohlizeni", jazyk: "en" })),
    ).toEqual({ format: "a5", variant: "view", language: "en" });
  });

  it("neznámé hodnoty padají na výchozí", () => {
    expect(parseGallerySignOptions(from({ format: "x", text: "y", jazyk: "de" }))).toEqual({
      format: "frame",
      variant: "upload",
      language: "both",
    });
  });
});
