// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import * as Sentry from "@sentry/nextjs";
import GlobalError from "./global-error";

describe("GlobalError", () => {
  it("hlásí chybu do Sentry a ukáže česko-anglickou zprávu v hlavní oblasti s vlastním lang", () => {
    const error = new Error("chyba");
    // `<html>` nejde vykreslit do `div`, proto se kontroluje obsah těla.
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<GlobalError error={error} reset={() => {}} />, { container: document.body });
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
    expect(screen.getByRole("main")).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings.map((h) => h.closest("[lang]")?.getAttribute("lang"))).toEqual(["cs", "en-GB"]);
    expect(screen.getByText("Něco se pokazilo")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});
