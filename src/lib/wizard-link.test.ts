import { describe, expect, it } from "vitest";
import { previewSlug } from "./slug-preview";
import { NAME_MAX_LENGTH, buildWizardUrl } from "./wizard-link";

describe("buildWizardUrl", () => {
  const base = { appUrl: "https://app.se-vezmou.cz", locale: "cs" } as const;

  it("složí adresu průvodce s jmény a jazykem", () => {
    expect(buildWizardUrl({ ...base, first: "Klára", second: "Matěj" })).toBe(
      "https://app.se-vezmou.cz/vytvorit?jmeno1=Kl%C3%A1ra&jmeno2=Mat%C4%9Bj&jazyk=cs",
    );
  });

  it("bez jmen předá jen jazyk; jiný než výchozí jazyk vede na průvodce s předponou", () => {
    expect(buildWizardUrl({ ...base, locale: "en" })).toBe(
      "https://app.se-vezmou.cz/en/vytvorit?jazyk=en",
    );
    expect(buildWizardUrl(base)).toBe("https://app.se-vezmou.cz/vytvorit?jazyk=cs");
  });

  it("vynechá prázdná jména, zahodí přebytečné mezery a omezí délku", () => {
    const url = new URL(
      buildWizardUrl({ ...base, first: "  Anna   Marie ", second: "x".repeat(200) }),
    );
    expect(url.searchParams.get("jmeno1")).toBe("Anna Marie");
    expect(url.searchParams.get("jmeno2")).toHaveLength(NAME_MAX_LENGTH);
    expect(new URL(buildWizardUrl({ ...base, first: "   " })).searchParams.has("jmeno1")).toBe(
      false,
    );
  });

  it("zvládne adresu s koncovým lomítkem a portem", () => {
    expect(buildWizardUrl({ appUrl: "http://app.localhost:3000/", locale: "cs" })).toBe(
      "http://app.localhost:3000/vytvorit?jazyk=cs",
    );
  });

  it("jména s úvodními znaky nemohou změnit cíl odkazu", () => {
    const url = new URL(
      buildWizardUrl({ ...base, first: "&jazyk=en#x", second: "//evil.example" }),
    );
    expect(url.origin).toBe("https://app.se-vezmou.cz");
    expect(url.searchParams.get("jazyk")).toBe("cs");
    expect(url.hash).toBe("");
  });
});

describe("previewSlug", () => {
  it("odstraní diakritiku a spojí jména", () => {
    expect(previewSlug("Klára", "Matěj")).toBe("klara-a-matej");
    expect(previewSlug("Šárka Marie", "Ondřej")).toBe("sarka-marie-a-ondrej");
  });

  it("s jedním jménem vrací jen to", () => {
    expect(previewSlug("Klára", "")).toBe("klara");
    expect(previewSlug("", "Matěj")).toBe("matej");
  });

  it("bez jmen nebo se samými symboly vrací null", () => {
    expect(previewSlug("", "  ")).toBeNull();
    expect(previewSlug("!!!", "???")).toBeNull();
  });
});
