// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Done } from "./done";
import { WizardI18nProvider } from "./i18n";
import { pickWizardMessages } from "./messages";

const wizardMessages = await pickWizardMessages("cs");

function renderDone(pin: string | null) {
  return render(
    <WizardI18nProvider locale="cs" messages={wizardMessages}>
      <Done
        uiLocale="cs"
        info={{
          slug: "klara-a-matej",
          url: "https://klara-a-matej.se-vezmou.cz",
          host: "klara-a-matej.se-vezmou.cz",
          pin,
        }}
      />
    </WizardI18nProvider>,
  );
}

describe("Done: obrazovka Hotovo", () => {
  it("je v hlavní oblasti s cílem odkazu přeskočení a zaměřeným nadpisem", () => {
    renderDone("483920");
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "obsah");
    expect(within(main).getByRole("heading", { level: 1 })).toHaveFocus();
  });

  it("PIN čtečka dostane po číslicích (aria-label na odstavci se ignoruje), vizuální PIN je skrytý", () => {
    renderDone("483920");
    const visual = screen.getByTestId("done-pin");
    expect(visual).toHaveAttribute("aria-hidden", "true");
    expect(visual).toHaveTextContent("483920");
    const paragraph = visual.parentElement as HTMLElement;
    expect(paragraph).not.toHaveAttribute("aria-label");
    expect(paragraph.querySelector(".sr-only")).toHaveTextContent("4 8 3 9 2 0");
  });

  it("bez PINu se karta s PINem nevykreslí", () => {
    renderDone(null);
    expect(screen.queryByTestId("done-pin")).toBeNull();
  });
});
