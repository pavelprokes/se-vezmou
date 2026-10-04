// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const join = vi.hoisted(() => vi.fn());
vi.mock("./waitlist-action", () => ({ joinWaitlist: join }));

import { WaitlistFormClient, type WaitlistLabels } from "./waitlist-form-client";

const labels: WaitlistLabels = {
  email: "Váš e-mail",
  consent: "Souhlasím",
  submit: "Přidat se",
  pending: "Odesílám",
  success: "Jste na seznamu.",
  honeypot: "Web",
  errors: {
    emailRequired: "Napište e-mail.",
    emailInvalid: "Zkontrolujte e-mail.",
    consentRequired: "Bez souhlasu to nejde.",
    rateLimited: "Příliš mnoho pokusů.",
    check: "Ještě ověřujeme.",
    bot: "Robot.",
    generic: "Něco se pokazilo.",
  },
};

beforeEach(() => {
  join.mockReset();
});

describe("WaitlistFormClient: zaměření a oznámení chyb", () => {
  it("po chybě zaměří chybné pole, pole zůstane stejným prvkem (živá oblast se nevytváří znovu) a e-mail zůstane", async () => {
    join.mockResolvedValue({
      status: "invalid",
      errors: { email: "invalid", consent: true },
      email: "neni-email",
    });
    const user = userEvent.setup();
    render(<WaitlistFormClient locale="cs" labels={labels} />);
    const field = screen.getByLabelText("Váš e-mail");
    await user.type(field, "neni-email");
    await user.click(screen.getByRole("button", { name: "Přidat se" }));

    await screen.findByText("Zkontrolujte e-mail.");
    expect(screen.getByLabelText("Váš e-mail")).toBe(field);
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveValue("neni-email");
  });

  it("chybí jen souhlas: zaměří se zaškrtávátko", async () => {
    join.mockResolvedValue({ status: "invalid", errors: { consent: true }, email: "a@b.cz" });
    const user = userEvent.setup();
    render(<WaitlistFormClient locale="cs" labels={labels} />);
    await user.type(screen.getByLabelText("Váš e-mail"), "a@b.cz");
    await user.click(screen.getByRole("button", { name: "Přidat se" }));
    await screen.findByText("Bez souhlasu to nejde.");
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Souhlasím" })).toHaveFocus());
  });

  it("chyba celého formuláře je v role=alert a zaměření zůstane na tlačítku", async () => {
    join.mockResolvedValue({ status: "rateLimited", email: "a@b.cz" });
    const user = userEvent.setup();
    render(<WaitlistFormClient locale="cs" labels={labels} />);
    await user.type(screen.getByLabelText("Váš e-mail"), "a@b.cz");
    await user.click(screen.getByRole("checkbox", { name: "Souhlasím" }));
    const button = screen.getByRole("button", { name: "Přidat se" });
    await user.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Příliš mnoho pokusů.");
    expect(button).toHaveFocus();
  });

  it("během odesílání je tlačítko aria-disabled (ne disabled) a druhé odeslání se zahodí", async () => {
    let resolve: (value: unknown) => void = () => {};
    join.mockImplementation(() => new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<WaitlistFormClient locale="cs" labels={labels} />);
    await user.type(screen.getByLabelText("Váš e-mail"), "a@b.cz");
    // `fireEvent` (ne `user.click`): akce zůstane nevyřízená, a `user.click` by na ni čekal.
    screen.getByRole("button", { name: "Přidat se" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Přidat se" }));
    const busy = await screen.findByRole("button", { name: "Odesílám" });
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).toHaveFocus();
    fireEvent.click(busy);
    expect(join).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ status: "success" }));
    await screen.findByText("Jste na seznamu.");
  });
});
