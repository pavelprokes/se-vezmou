// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HeaderMenu } from "./header-menu";
import { HeroStudio } from "./hero-studio";
import { NameForm, type NameFormLabels } from "./name-form";

const labels: NameFormLabels = {
  first: "První jméno",
  second: "Druhé jméno",
  firstPlaceholder: "Klára",
  secondPlaceholder: "Matěj",
  submit: "Pokračovat",
  form: "Jména páru",
};

function renderForm(variant: "hero" | "cta") {
  return render(
    <NameForm appUrl="https://app.se-vezmou.cz" locale="cs" labels={labels} variant={variant} />,
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

  it("v jiném než výchozím jazyce vede na průvodce s předponou jazyka", () => {
    render(
      <NameForm appUrl="https://app.se-vezmou.cz" locale="en" labels={labels} variant="cta" />,
    );
    const form = screen.getByRole("form", { name: "Jména páru" });
    expect(form).toHaveAttribute("action", "https://app.se-vezmou.cz/en/vytvorit");
    expect(form.querySelector('input[name="jazyk"]')).toHaveValue("en");
  });

  it("pole mají viditelné popisky a nejsou povinná", () => {
    renderForm("cta");
    expect(screen.getByLabelText("První jméno")).not.toBeRequired();
    expect(screen.getByLabelText("První jméno")).toHaveAttribute("placeholder", "Klára");
  });
});

describe("HeroStudio", () => {
  function renderStudio() {
    return render(
      <HeroStudio
        appUrl="https://app.se-vezmou.cz"
        locale="cs"
        domain="se-vezmou.cz"
        formLabels={labels}
        addressLabel="Adresa vašeho webu"
        templatesLabel="Šablona náhledu"
        templates={[
          { key: "editorial", name: "Editorial" },
          { key: "modern", name: "Modern" },
        ]}
        dateplace="12. června 2027 · Praha"
        rsvp="Potvrdit účast"
        intro={<h1>Nadpis</h1>}
        outro={null}
      />,
    );
  }

  it("jména z formuláře skládají živý náhled adresy", async () => {
    const user = userEvent.setup();
    renderStudio();
    const preview = screen.getByTestId("address-preview");
    expect(preview).toHaveTextContent("klara-a-matej.se-vezmou.cz");

    await user.type(screen.getByLabelText("První jméno"), "Šárka");
    await user.type(screen.getByLabelText("Druhé jméno"), "Ondřej");
    expect(preview).toHaveTextContent("sarka-a-ondrej.se-vezmou.cz");
    // Náhled webu (ozdoba) ukazuje zadaná jména; hodnota pole se do textContent nepočítá.
    expect(document.body).toHaveTextContent(/Šárka\s*& Ondřej/);
  });

  it("jméno bez písmen nerozbije adresu: zůstane ukázková", async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.type(screen.getByLabelText("První jméno"), "!!!");
    expect(screen.getByTestId("address-preview")).toHaveTextContent("klara-a-matej.se-vezmou.cz");
  });

  it("přepínač šablon je skupina tlačítek s aria-pressed", async () => {
    const user = userEvent.setup();
    renderStudio();
    const group = screen.getByRole("group", { name: "Šablona náhledu" });
    const modern = within(group).getByRole("button", { name: "Modern" });
    expect(within(group).getByRole("button", { name: "Editorial" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(modern);
    expect(modern).toHaveAttribute("aria-pressed", "true");
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
