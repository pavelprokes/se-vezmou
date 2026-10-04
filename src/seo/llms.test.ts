import { describe, expect, it } from "vitest";
import { buildLlmsTxt } from "./llms";

describe("buildLlmsTxt", () => {
  it("nadpis, shrnutí, oddíly s odkazy; titulky bez názvu webu a bez nezlomitelných mezer", () => {
    const text = buildLlmsTxt({
      name: "Se vezmou",
      summary: ["Svatební web zdarma."],
      details: ["Kontakt: info@se-vezmou.cz"],
      sections: [
        {
          heading: "Stránky",
          links: [
            { title: "Ceník | Se vezmou", url: "https://se-vezmou.cz/cenik", description: "Cena." },
          ],
        },
      ],
    });
    expect(text).toBe(
      [
        "# Se vezmou",
        "",
        "> Svatební web zdarma.",
        "",
        "Kontakt: info@se-vezmou.cz",
        "",
        "## Stránky",
        "",
        "- [Ceník](https://se-vezmou.cz/cenik): Cena.",
        "",
      ].join("\n"),
    );
  });
});
