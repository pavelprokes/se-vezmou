import { describe, expect, it } from "vitest";
import { phaseFromDates } from "./phase";

const at = (iso: string) => new Date(iso);

describe("phaseFromDates", () => {
  it("bez data svatby je koncept otevřený pro potvrzení účasti", () => {
    expect(phaseFromDates({ startsOn: "" })).toBe("rsvp_open");
  });

  it("před svatbou je potvrzení otevřené, po uzávěrce zavřené", () => {
    const input = { startsOn: "2027-06-19", deadline: "2027-05-31" };
    expect(phaseFromDates(input, at("2027-05-30T10:00:00Z"))).toBe("rsvp_open");
    expect(phaseFromDates(input, at("2027-05-31T10:00:00Z"))).toBe("rsvp_open");
    expect(phaseFromDates(input, at("2027-06-01T10:00:00Z"))).toBe("rsvp_closed");
  });

  it("v den svatby, u vícedenní do posledního dne, potom poděkování", () => {
    const input = { startsOn: "2027-06-19", endsOn: "2027-06-20" };
    expect(phaseFromDates(input, at("2027-06-19T10:00:00Z"))).toBe("wedding_day");
    expect(phaseFromDates(input, at("2027-06-20T10:00:00Z"))).toBe("wedding_day");
    expect(phaseFromDates(input, at("2027-06-21T10:00:00Z"))).toBe("thanks");
  });

  it("den se počítá v pásmu svatby (půlnoc podle Prahy)", () => {
    const input = { startsOn: "2027-06-19" };
    // 22:30 UTC je v Praze už 20. 6. (letní čas)
    expect(phaseFromDates(input, at("2027-06-19T22:30:00Z"), "Europe/Prague")).toBe("thanks");
    expect(phaseFromDates(input, at("2027-06-19T22:30:00Z"), "UTC")).toBe("wedding_day");
  });
});
