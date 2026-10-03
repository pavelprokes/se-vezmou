// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmButton } from "./confirm-button";
import { AdminI18nProvider } from "./i18n";
import { pickAdminMessages } from "./messages";

const adminMessages = await pickAdminMessages("cs");

function renderButton(onConfirm = vi.fn(), disabled = false) {
  render(
    <AdminI18nProvider locale="cs" messages={adminMessages}>
      <ConfirmButton
        label="Smazat"
        question="Opravdu smazat?"
        confirmLabel="Ano, smazat"
        onConfirm={onConfirm}
        disabled={disabled}
      />
    </AdminI18nProvider>,
  );
  return onConfirm;
}

describe("ConfirmButton: zaměření (WCAG 2.4.3)", () => {
  it("první klik zaměří potvrzení, Escape vrátí zaměření na tlačítko", async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole("button", { name: "Smazat" }));
    expect(screen.getByRole("button", { name: "Ano, smazat" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Smazat" })).toHaveFocus();
  });

  it("Zrušit vrátí zaměření na tlačítko, nic se nepotvrdí", async () => {
    const user = userEvent.setup();
    const onConfirm = renderButton();
    await user.click(screen.getByRole("button", { name: "Smazat" }));
    await user.click(screen.getByRole("button", { name: "Zrušit" }));
    expect(screen.getByRole("button", { name: "Smazat" })).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Ano potvrdí a zaměření zůstane na tlačítku, když ho volající neodstranil", async () => {
    const user = userEvent.setup();
    const onConfirm = renderButton();
    await user.click(screen.getByRole("button", { name: "Smazat" }));
    await user.click(screen.getByRole("button", { name: "Ano, smazat" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Smazat" })).toHaveFocus();
  });

  it("zaneprázdněné tlačítko je aria-disabled, nic neotevře a neztratí zaměření", async () => {
    const user = userEvent.setup();
    renderButton(vi.fn(), true);
    const button = screen.getByRole("button", { name: "Smazat" });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    await user.click(button);
    expect(screen.queryByRole("group")).toBeNull();
  });
});
