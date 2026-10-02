import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WeddingPhase, WeddingStatus } from "@/lib/db/types";
import { derivePhase } from "./phase";

/**
 * Zlaté vektory sdílené s SQL (`supabase/tests/golden/phase-vectors.tsv`, test `96_m10_lifecycle`):
 * název, stav, pásmo, začátek, konec, nastavení RSVP (t/f), otevření, uzavření, okamžik, přepsání,
 * očekávaná fáze. `\N` je null jako v COPY.
 */
const nul = (value: string) => (value === "\\N" ? null : value);

const vectors = readFileSync(join(process.cwd(), "supabase/tests/golden/phase-vectors.tsv"), "utf8")
  .split("\n")
  .filter((line) => line !== "")
  .map((line) => {
    const f = line.split("\t");
    return {
      name: f[0],
      status: f[1] as WeddingStatus,
      timezone: f[2],
      startsOn: nul(f[3]),
      endsOn: nul(f[4]),
      hasSettings: f[5] === "t",
      opensAt: nul(f[6]),
      closesAt: nul(f[7]),
      at: f[8],
      override: nul(f[9]) as WeddingPhase | null,
      expected: nul(f[10]) as WeddingPhase | null,
    };
  });

describe("odvozená fáze: zlaté vektory shodné s SQL", () => {
  it("soubor má dost vektorů a každý řádek 11 polí", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(15);
    for (const v of vectors) expect(v.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it.each(vectors.map((v) => [v.name, v] as const))("%s", (_name, v) => {
    const phase = derivePhase(
      {
        status: v.status,
        timezone: v.timezone,
        startsOn: v.startsOn,
        endsOn: v.endsOn,
        rsvp: v.hasSettings
          ? {
              opensAt: v.opensAt ? new Date(v.opensAt) : null,
              closesAt: v.closesAt ? new Date(v.closesAt) : null,
            }
          : null,
        phaseOverride: v.override,
      },
      new Date(v.at),
    );
    expect(phase).toBe(v.expected);
  });
});
