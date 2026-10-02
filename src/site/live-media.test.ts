import { describe, expect, it } from "vitest";
import { liveMedia } from "./live-media";

describe("liveMedia", () => {
  const media = [
    { id: "9D2F1A40-5B6C-4D7E-8F90-A1B2C3D4E5F6", widths: [640, 1280] },
    { id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", widths: [640] },
    { id: "m1", widths: [] },
  ];

  it("vyřadí média, která v databázi už nejsou hotová (smazaná fotografie zmizí hned)", () => {
    const alive = new Set(["9d2f1a40-5b6c-4d7e-8f90-a1b2c3d4e5f6"]);
    expect(liveMedia(media, alive).map((m) => m.id)).toEqual([
      "9D2F1A40-5B6C-4D7E-8F90-A1B2C3D4E5F6",
      "m1",
    ]);
  });

  it("média bez variant (starší snímky, fixtury) se nevyřazují", () => {
    expect(liveMedia(media, new Set()).map((m) => m.id)).toEqual(["m1"]);
  });

  it("prázdný seznam zůstane prázdný", () => {
    expect(liveMedia([], new Set(["x"]))).toEqual([]);
  });
});
