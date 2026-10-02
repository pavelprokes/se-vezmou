// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HeaderMenu } from "./header-menu";
import { NameForm, type NameFormLabels } from "./name-form";

const labels: NameFormLabels = {
  first: "První jméno",
  second: "Druhé jméno",
  firstPlaceholder: "Klára",
  secondPlaceholder: "Matěj",
  address: "Adresa vašeho webu",
  submit: "Pokračovat",
  form: "Jména páru",
};

function renderForm(variant: "intro" | "cta") {
  return render(
    <NameForm
      appUrl="https://app.se-vezmou.cz"
      locale="cs"
      domain="se-vezmou.cz"
      labels={labels}
      variant={variant}
    />,
  );
}

describe("NameForm", () => {
  it("je obyčejné GET na adresu průvodce, takže funguje i bez JavaScriptu", () => {
    renderForm("cta");
    const form = screen.getByRole("form", { name: "Jména páru" });
    expect(form).toHaveAttribute("action", "https://app.se-vezmou.cz/vytvorit");
    expect(form).toHaveAttribute("method", "get");
    expect(screen.getByLabelText("První jméno")).toHaveAttribute("name", "jmeno1");
    expect(screen.getByLabelText("Druhé jméno")).toHaveAttribute("name", "jmeno2");
    expect(form.querySelector('input[name="jazyk"]')).toHaveValue("cs");
  });

  it("pole mají viditelné popisky a nejsou povinná", () => {
    renderForm("cta");
    expect(screen.getByLabelText("První jméno")).not.toBeRequired();
    expect(screen.getByLabelText("První jméno")).toHaveAttribute("placeholder", "Klára");
  });

  it("varianta intro skládá živý náhled adresy z jmen", async () => {
    const user = userEvent.setup();
    renderForm("intro");
    const preview = screen.getByTestId("address-preview");
    expect(preview).toHaveTextContent("klara-a-matej.se-vezmou.cz");

    await user.type(screen.getByLabelText("První jméno"), "Šárka");
    await user.type(screen.getByLabelText("Druhé jméno"), "Ondřej");
    expect(preview).toHaveTextContent("sarka-a-ondrej.se-vezmou.cz");
  });

  it("varianta cta náhled adresy nemá", () => {
    renderForm("cta");
    expect(screen.queryByTestId("address-preview")).not.toBeInTheDocument();
  });
});

describe("HeaderMenu", () => {
  function renderMenu() {
    return render(
      <header>
        <HeaderMenu buttonLabel="Nabídka">
          <a href="#cena">Cena</a>
        </HeaderMenu>
      </header>,
    );
  }

  it("tlačítko ovládá panel přes aria-expanded a aria-controls", async () => {
    const user = userEvent.setup();
    renderMenu();
    const button = screen.getByRole("button", { name: "Nabídka" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    const panelId = button.getAttribute("aria-controls") as string;
    const panel = document.getElementById(panelId) as HTMLElement;
    expect(panel).toHaveClass("hidden");

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(panel).not.toHaveClass("hidden");
  });

  it("Escape panel zavře a vrátí zaměření na tlačítko (klávesnice)", async () => {
    const user = userEvent.setup();
    renderMenu();
    const button = screen.getByRole("button", { name: "Nabídka" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(button).toHaveAttribute("aria-expanded", "true");
    await user.tab();
    expect(screen.getByRole("link", { name: "Cena" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();
  });

  it("klepnutí na odkaz panel zavře", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Nabídka" }));
    await user.click(screen.getByRole("link", { name: "Cena" }));
    expect(screen.getByRole("button", { name: "Nabídka" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
