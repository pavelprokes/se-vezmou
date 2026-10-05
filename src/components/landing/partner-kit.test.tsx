// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PartnerKit, partnerCode, partnerUrl, type PartnerKitLabels } from "./partner-kit";

const labels: PartnerKitLabels = {
  name: "Jméno studia",
  nameHint: "nápověda",
  link: "Váš odkaz",
  copy: "Kopírovat",
  copyLabel: "Kopírovat odkaz",
  copied: "Zkopírováno",
  qr: "QR kód s odkazem",
  print: "Vytisknout leták",
  empty: "Napište jméno",
  leafletTitle: "Leták",
  leafletLead: "úvod",
  leafletPoints: ["a", "b", "c"],
  leafletScan: "Naskenujte",
  leafletBy: "Doporučuje {name}",
};

describe("partnerCode a partnerUrl", () => {
  it("kód bez diakritiky, malými písmeny se spojovníky, nejvýš 40 znaků", () => {
    expect(partnerCode("  Foto Klára Nová & Žofie! ")).toBe("foto-klara-nova-zofie");
    expect(partnerCode("!!!")).toBe("");
    expect(partnerCode("a".repeat(39) + " b")).toBe("a".repeat(39));
  });

  it("odkaz nese UTM parametry partnera", () => {
    const url = new URL(partnerUrl("https://se-vezmou.cz/", "foto-nova"));
    expect(url.searchParams.get("utm_source")).toBe("foto-nova");
    expect(url.searchParams.get("utm_medium")).toBe("partner");
    expect(url.searchParams.get("utm_campaign")).toBe("doporuceni");
  });
});

describe("PartnerKit", () => {
  it("po napsání jména ukáže odkaz, QR kód a leták se jménem", async () => {
    render(<PartnerKit homeUrl="https://se-vezmou.cz/" labels={labels} />);
    expect(screen.getByText("Napište jméno")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Jméno studia"), "Foto Nová");
    expect(screen.getByTestId("partner-url")).toHaveTextContent("utm_source=foto-nova");
    expect(screen.getAllByRole("img", { name: "QR kód s odkazem" })).toHaveLength(2);
    expect(screen.getByText("Doporučuje Foto Nová")).toBeInTheDocument();
  });
});
