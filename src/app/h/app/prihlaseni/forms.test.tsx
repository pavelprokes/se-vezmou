// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  requestCodeAction: vi.fn(),
  verifyCodeAction: vi.fn(),
  confirmLinkAction: vi.fn(),
  pinLoginAction: vi.fn(),
}));
vi.mock("./actions", () => actions);

import { CodeForm, EmailForm, LinkConfirmForm, PinForm } from "./forms";

const errors = {
  invalid_email: "Zadejte platný e-mail.",
  limited: "Zkuste to později.",
  generic: "Něco se nepovedlo.",
  expired: "Přihlášení vypršelo.",
  format: "Kód má šest číslic.",
  wrong: "Kód nesouhlasí.",
  invalid: "Adresa nebo PIN nesouhlasí.",
  locked: "Pauza {pause}.",
};

describe("pole pro kód (WCAG 3.3.8)", () => {
  const labels = { code: "Šestimístný kód", hint: "Vložte kód.", submit: "Přihlásit se", errors };

  it("je jedno běžné pole s nápovědou pro SMS i e-mail a číselnou klávesnicí", () => {
    render(<CodeForm labels={labels} />);
    const input = screen.getByLabelText("Šestimístný kód");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(input).toHaveAttribute("inputmode", "numeric");
    // žádné rozdělení do políček a žádné omezení délky, které by uřízlo vložený "123 456"
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(input).not.toHaveAttribute("maxlength");
  });

  it("přijme vložení ze schránky i s mezerou", async () => {
    const user = userEvent.setup();
    render(<CodeForm labels={labels} />);
    const input = screen.getByLabelText("Šestimístný kód");
    await user.click(input);
    await user.paste("048 213");
    expect(input).toHaveValue("048 213");
  });

  it("nechává pole popsané nápovědou", () => {
    render(<CodeForm labels={labels} />);
    const input = screen.getByLabelText("Šestimístný kód");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)).toHaveTextContent(
      "Vložte kód.",
    );
  });

  it("po chybě oznámí zprávu v živé oblasti a označí pole", async () => {
    actions.verifyCodeAction.mockResolvedValue({ error: "wrong" });
    const user = userEvent.setup();
    render(<CodeForm labels={labels} />);
    await user.type(screen.getByLabelText("Šestimístný kód"), "111111");
    await user.click(screen.getByRole("button", { name: "Přihlásit se" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Šestimístný kód")).toHaveAttribute("aria-invalid", "true"),
    );
    expect(screen.getByText("Kód nesouhlasí.")).toBeInTheDocument();
    expect(screen.getByLabelText("Šestimístný kód")).toHaveFocus();
  });
});

describe("e-mailový formulář", () => {
  const labels = { email: "E-mail", hint: "Pošleme kód.", submit: "Poslat kód", errors };

  it("pole e-mailu má správné atributy a je povinné", () => {
    render(<EmailForm labels={labels} />);
    const input = screen.getByLabelText("E-mail");
    expect(input).toHaveAttribute("type", "email");
    expect(input).toHaveAttribute("autocomplete", "email");
    expect(input).toBeRequired();
  });

  it("chybu e-mailu ukáže u pole a ponechá zadanou hodnotu", async () => {
    actions.requestCodeAction.mockResolvedValue({ error: "invalid_email", value: "klara@" });
    const user = userEvent.setup();
    render(<EmailForm labels={labels} />);
    await user.type(screen.getByLabelText("E-mail"), "klara@");
    await user.click(screen.getByRole("button", { name: "Poslat kód" }));
    await waitFor(() => expect(screen.getByText("Zadejte platný e-mail.")).toBeInTheDocument());
    expect(screen.getByLabelText("E-mail")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("E-mail")).toHaveValue("klara@");
  });

  it("obecnou chybu ukáže ve společné živé oblasti formuláře", async () => {
    actions.requestCodeAction.mockResolvedValue({ error: "limited", value: "klara@example.cz" });
    const user = userEvent.setup();
    render(<EmailForm labels={labels} />);
    await user.type(screen.getByLabelText("E-mail"), "klara@example.cz");
    await user.click(screen.getByRole("button", { name: "Poslat kód" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Zkuste to později."));
  });

  it("živá oblast role=alert je v DOM i bez chyby", () => {
    render(<EmailForm labels={labels} />);
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });
});

describe("formulář PINu", () => {
  const labels = {
    slug: "Adresa webu",
    slugHint: "Například klara-a-matej.",
    pin: "PIN ke správě",
    pinHint: "Nejméně šest číslic.",
    submit: "Přihlásit se PINem",
    errors,
  };

  it("PIN jde vložit ze schránky a nabízí číselnou klávesnici", async () => {
    const user = userEvent.setup();
    render(<PinForm labels={labels} />);
    const pin = screen.getByLabelText("PIN ke správě");
    expect(pin).toHaveAttribute("inputmode", "numeric");
    expect(pin).toHaveAttribute("autocomplete", "current-password");
    await user.click(pin);
    await user.paste("482915");
    expect(pin).toHaveValue("482915");
  });

  it("do pauzy doplní délku pauzy z odpovědi serveru", async () => {
    actions.pinLoginAction.mockResolvedValue({ error: "locked", pause: "15 minut", value: "x" });
    const user = userEvent.setup();
    render(<PinForm labels={labels} />);
    await user.type(screen.getByLabelText("Adresa webu"), "x");
    await user.type(screen.getByLabelText("PIN ke správě"), "482915");
    await user.click(screen.getByRole("button", { name: "Přihlásit se PINem" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Pauza 15 minut."));
  });
});

describe("potvrzení odkazu", () => {
  it("odesílá zapečetěný odkaz jako skryté pole", () => {
    render(<LinkConfirmForm token="abc" labels={{ submit: "Přihlásit se", errors }} />);
    expect(document.querySelector('input[type="hidden"][name="t"]')).toHaveValue("abc");
    expect(screen.getByRole("button", { name: "Přihlásit se" })).toBeInTheDocument();
  });
});
