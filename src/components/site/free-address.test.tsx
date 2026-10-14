// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "font-fraunces-test" }) }));

import { FreeAddress } from "./free-address";

async function renderPage(
  locale: "cs" | "en",
  slug = "david-and-lil",
  host = `${slug}.se-vezmou.cz`,
) {
  render(await FreeAddress({ locale, slug, host }));
}

describe("FreeAddress", () => {
  it("česky: h1 s adresou, stav, jedno hlavní tlačítko na průvodce, landmark main", async () => {
    await renderPage("cs", "david-a-lil");
    const main = screen.getByRole("main");
    const h1 = within(main).getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("david-a-lil.se-vezmou.cz");
    expect(main).toHaveTextContent("Volná");
    expect(main).toHaveTextContent("Tato adresa je volná. Vytvořte si na ní svatební web.");

    const cta = within(main).getByRole("link", { name: "Vytvořit web na této adrese" });
    const url = new URL(cta.getAttribute("href") ?? "");
    expect(url.pathname).toBe("/vytvorit");
    expect(url.searchParams.get("adresa")).toBe("david-a-lil");
    expect(url.searchParams.get("jmeno1")).toBe("David");
    expect(url.searchParams.get("jmeno2")).toBe("Lil");
    expect(url.searchParams.get("jazyk")).toBe("cs");
    // Jedno hlavní tlačítko: ostatní odkazy v hlavní části nejsou tlačítka.
    expect(within(main).getAllByRole("link")).toHaveLength(2);
  });

  it("anglicky: vlastní text, průvodce s předponou jazyka a jména z `-and-`", async () => {
    await renderPage("en");
    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { level: 1 })).toHaveTextContent(
      "david-and-lil.se-vezmou.cz",
    );
    expect(main).toHaveTextContent("This address is available. Build your wedding website on it.");
    const cta = within(main).getByRole("link", { name: "Create a site at this address" });
    const url = new URL(cta.getAttribute("href") ?? "");
    expect(url.pathname).toBe("/en/vytvorit");
    expect(url.searchParams.get("adresa")).toBe("david-and-lil");
    expect(url.searchParams.get("jmeno1")).toBe("David");
    expect(url.searchParams.get("jazyk")).toBe("en");
  });

  it("nejednoznačná adresa: odkaz bez jmen, jen s adresou", async () => {
    await renderPage("cs", "nase-svatba");
    const cta = screen.getByRole("link", { name: "Vytvořit web na této adrese" });
    const url = new URL(cta.getAttribute("href") ?? "");
    expect(url.searchParams.has("jmeno1")).toBe(false);
    expect(url.searchParams.has("jmeno2")).toBe(false);
    expect(url.searchParams.get("adresa")).toBe("nase-svatba");
  });

  it("jazyk adresy je s lang, aktuální jazyk má aria-current, tři kroky jsou číslovaný seznam", async () => {
    await renderPage("cs");
    const nav = screen.getByRole("navigation", { name: "Jazyk" });
    expect(within(nav).getByRole("link", { name: /EN/ })).toHaveAttribute("href", "/en");
    expect(within(nav).getByRole("link", { name: /CS/ })).toHaveAttribute("aria-current", "true");
    const steps = screen.getByRole("list", { name: "Postup" });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(3);
  });

  it("odkaz na ukázky šablon vede na úvodní stránku, ne na web páru", async () => {
    await renderPage("cs");
    const link = screen.getByRole("link", { name: "Podívat se na ukázky šablon" });
    expect(new URL(link.getAttribute("href") ?? "").pathname).toBe("/sablony");
    expect(link.getAttribute("href")).toMatch(/^https?:\/\//);
  });

  it("nic z adresy se nevkládá jako HTML", async () => {
    await renderPage("cs", "abc", "abc.se-vezmou.cz");
    expect(document.querySelector("script")).toBeNull();
  });
});
