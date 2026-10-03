// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Heart } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { Accordion } from "./accordion";
import { Button, buttonVariants } from "./button";
import { Card } from "./card";
import { Checkbox, Radio } from "./choice";
import { Field, Fieldset } from "./field";
import { FormAlert } from "./form-alert";
import { Icon } from "./icon";
import { localeNames, localeShortNames, locales, type Locale } from "@/i18n/config";
import { LanguageSwitcher } from "./language-switcher";
import { SkipLink } from "./skip-link";

describe("Button", () => {
  it("je ve výchozím stavu type=button, aby neodeslal formulář", () => {
    render(<Button>Pošli</Button>);
    expect(screen.getByRole("button", { name: "Pošli" })).toHaveAttribute("type", "button");
  });

  it("reaguje na klik a po zakázání ne", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Button onClick={onClick}>Pošli</Button>);
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button onClick={onClick} disabled>
        Pošli
      </Button>,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("zakázané tlačítko zůstane zaměřitelné (aria-disabled), klik ani odeslání formuláře neprojde", async () => {
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <input aria-label="Pole" />
        <Button type="submit" onClick={onClick} disabled>
          Pošli
        </Button>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Pošli" });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    await user.tab();
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByLabelText("Pole"));
    await user.keyboard("{Enter}");
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("má zaoblení 10 px a cíl 44 px ve všech variantách", () => {
    for (const variant of ["primary", "secondary", "text"] as const) {
      const classes = buttonVariants({ variant });
      expect(classes).toContain("rounded-button");
      expect(classes).toContain("min-h-target");
    }
  });
});

describe("Field", () => {
  it("propojí popisek, nápovědu a chybu s polem", () => {
    render(<Field label="E-mail" hint="Napište ho celý" error="Chybí zavináč" />);
    const input = screen.getByLabelText("E-mail");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(describedBy).toHaveLength(2);
    expect(document.getElementById(describedBy[0])).toHaveTextContent("Napište ho celý");
    expect(document.getElementById(describedBy[1])).toHaveTextContent("Chybí zavináč");
  });

  it("bez chyby nemá aria-invalid ani aria-describedby", () => {
    render(<Field label="Jméno" />);
    const input = screen.getByLabelText("Jméno");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("předá autoComplete a další atributy (WCAG 1.3.5)", () => {
    render(<Field label="E-mail" type="email" autoComplete="email" required />);
    const input = screen.getByLabelText("E-mail");
    expect(input).toHaveAttribute("autocomplete", "email");
    expect(input).toBeRequired();
  });

  it("dvě pole mají různá id", () => {
    render(
      <>
        <Field label="A" />
        <Field label="B" />
      </>,
    );
    expect(screen.getByLabelText("A").id).not.toBe(screen.getByLabelText("B").id);
  });
});

describe("Checkbox, Radio, Fieldset", () => {
  it("zaškrtávací pole se přepíná klikem na popisek", async () => {
    const user = userEvent.setup();
    render(<Checkbox label="Vegetariánské menu" />);
    const box = screen.getByRole("checkbox", { name: "Vegetariánské menu" });
    await user.click(screen.getByText("Vegetariánské menu"));
    expect(box).toBeChecked();
  });

  it("přepínače tvoří skupinu s legendou a vybírá se jen jeden", async () => {
    const user = userEvent.setup();
    render(
      <Fieldset legend="Přijdete?">
        <Radio label="Ano" name="a" value="yes" />
        <Radio label="Ne" name="a" value="no" />
      </Fieldset>,
    );
    expect(screen.getByRole("group", { name: "Přijdete?" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Ano" }));
    await user.click(screen.getByRole("radio", { name: "Ne" }));
    expect(screen.getByRole("radio", { name: "Ano" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Ne" })).toBeChecked();
  });

  it("chyba skupiny je připojená přes aria-describedby", () => {
    render(
      <Fieldset legend="Přijdete?" error="Vyberte odpověď">
        <Radio label="Ano" name="a" />
      </Fieldset>,
    );
    const group = screen.getByRole("group");
    const id = group.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(id)).toHaveTextContent("Vyberte odpověď");
  });
});

describe("Card", () => {
  it("vykreslí zvolený prvek", () => {
    render(
      <Card as="article" aria-label="Pár">
        Obsah
      </Card>,
    );
    expect(screen.getByRole("article", { name: "Pár" })).toHaveTextContent("Obsah");
  });
});

describe("Accordion", () => {
  const items = [
    { id: "a", title: "Otázka A", content: "Odpověď A" },
    { id: "b", title: "Otázka B", content: "Odpověď B" },
  ];

  it("je na nativním details, ve výchozím stavu zavřený", () => {
    const { container } = render(<Accordion items={items} />);
    const details = container.querySelectorAll("details");
    expect(details).toHaveLength(2);
    details.forEach((d) => expect(d.open).toBe(false));
  });

  it("rozbalí se klikem na souhrn", async () => {
    const user = userEvent.setup();
    const { container } = render(<Accordion items={items} />);
    await user.click(screen.getByText("Otázka A"));
    expect(container.querySelectorAll("details")[0].open).toBe(true);
    expect(container.querySelectorAll("details")[1].open).toBe(false);
  });
});

describe("SkipLink", () => {
  it("odkazuje na kotvu obsahu", () => {
    render(<SkipLink>Přeskočit na obsah</SkipLink>);
    expect(screen.getByRole("link", { name: "Přeskočit na obsah" })).toHaveAttribute(
      "href",
      "#obsah",
    );
  });
});

describe("Icon", () => {
  it("dekorativní ikona je skrytá před čtečkami", () => {
    const { container } = render(<Icon icon={Heart} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
  });

  it("ikona s popiskem má role=img a stroke-width 2", () => {
    render(<Icon icon={Heart} label="Srdce" />);
    const svg = screen.getByRole("img", { name: "Srdce" });
    expect(svg).toHaveAttribute("stroke-width", "2");
  });
});

describe("LanguageSwitcher", () => {
  const props = {
    current: "cs" as const,
    hrefs: { cs: "/", en: "/en" },
    label: "Jazyk",
  };

  it("je navigace s odkazy bez automatického přesměrování", () => {
    render(<LanguageSwitcher {...props} />);
    expect(screen.getByRole("navigation", { name: "Jazyk" })).toBeInTheDocument();
    const en = screen.getByRole("link", { name: "English" });
    expect(en).toHaveAttribute("href", "/en");
    expect(en).toHaveAttribute("lang", "en");
    expect(en).toHaveAttribute("hreflang", "en");
  });

  it("aktuální jazyk má aria-current, druhý ne", () => {
    render(<LanguageSwitcher {...props} />);
    expect(screen.getByRole("link", { name: "Čeština" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "English" })).not.toHaveAttribute("aria-current");
  });

  it("nabízí každý jazyk z konfigurace jeho vlastním názvem, zkratky mají celý přístupný název", () => {
    const hrefs = Object.fromEntries(locales.map((l) => [l, `/${l}`])) as Record<Locale, string>;
    const { rerender } = render(<LanguageSwitcher current="cs" hrefs={hrefs} label="Jazyk" />);
    for (const locale of locales) {
      expect(screen.getByRole("link", { name: localeNames[locale] })).toHaveAttribute(
        "href",
        `/${locale}`,
      );
    }
    rerender(<LanguageSwitcher current="cs" hrefs={hrefs} label="Jazyk" short />);
    for (const locale of locales) {
      const link = screen.getByRole("link", {
        name: `${localeShortNames[locale]}, ${localeNames[locale]}`,
      });
      expect(link).toHaveTextContent(localeShortNames[locale]);
    }
  });
});

describe("FormAlert", () => {
  it("živá oblast role=alert je v DOM i bez zprávy, aby čtečky novou chybu oznámily", () => {
    const { rerender } = render(<FormAlert />);
    const region = screen.getByRole("alert");
    expect(region).toBeEmptyDOMElement();

    rerender(<FormAlert>Kód nesouhlasí.</FormAlert>);
    expect(screen.getByRole("alert")).toBe(region);
    expect(region).toHaveTextContent("Kód nesouhlasí.");
  });

  it("chyba není jen barva: nese ikonu skrytou před čtečkami a text", () => {
    render(<FormAlert>Chyba</FormAlert>);
    expect(screen.getByRole("alert").querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
