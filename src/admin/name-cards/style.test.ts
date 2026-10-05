import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/design/contrast";
import { templateKeys, templates } from "@/site/themes/palettes";
import { cardStyle, PAPER } from "./style";

const all = templateKeys.flatMap((template) =>
  templates[template].palettes.map((palette) => [template, palette.key] as const),
);

describe("vzhled jmenovky podle šablony", () => {
  it.each(all)("%s / %s: jméno a údaje čitelné na bílém papíře (4,5 : 1)", (template, palette) => {
    const style = cardStyle(template, palette);
    expect(contrastRatio(style.name, PAPER)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(style.detail, PAPER)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(style.ornamentColor, PAPER)).toBeGreaterThanOrEqual(1.6);
  });

  it("tmavá paleta nepoužije svůj světlý text, vezme barvu výchozí palety", () => {
    const style = cardStyle("modern", "limeta");
    expect(style.name).not.toBe(
      templates.modern.palettes.find((p) => p.key === "limeta")?.colors.text,
    );
  });

  it("Modern je bezpatkový s pruhem, Chateau patkový s kosočtvercem", () => {
    expect(cardStyle("modern", "slunce")).toMatchObject({ font: "sans", ornament: "bar" });
    expect(cardStyle("chateau", "champagne")).toMatchObject({ font: "serif", ornament: "gem" });
  });
});
