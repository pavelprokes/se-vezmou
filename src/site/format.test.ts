import { describe, expect, it } from "vitest";
import { dayInZone, daysUntil, formatDateRange, formatDay, formatTime } from "./format";

describe("datum a čas v pásmu svatby", () => {
  it("odpočet počítá kalendářní dny v pásmu svatby", () => {
    const now = new Date("2026-10-02T10:00:00+02:00");
    expect(daysUntil("2026-10-02", "Europe/Prague", now)).toBe(0);
    expect(daysUntil("2026-10-03", "Europe/Prague", now)).toBe(1);
    expect(daysUntil("2027-06-19", "Europe/Prague", now)).toBe(260);
    expect(daysUntil("2026-10-01", "Europe/Prague", now)).toBe(-1);
  });

  it("v půlnoci rozhoduje pásmo svatby, ne pásmo serveru", () => {
    // 23:30 UTC je v Praze (UTC+2) už další den.
    const now = new Date("2026-07-01T23:30:00Z");
    expect(dayInZone(now, "Europe/Prague")).toBe("2026-07-02");
    expect(dayInZone(now, "UTC")).toBe("2026-07-01");
    expect(daysUntil("2026-07-02", "Europe/Prague", now)).toBe(0);
    expect(daysUntil("2026-07-02", "UTC", now)).toBe(1);
  });

  it("formátuje den česky a anglicky s nezlomitelnými mezerami", () => {
    expect(formatDay("2027-06-19", "cs")).toBe("19. června 2027");
    expect(formatDay("2027-06-19", "en")).toBe("19 June 2027");
  });

  it("formátuje rozsah vícedenní svatby", () => {
    expect(formatDateRange("2027-06-19", null, "en")).toBe("19 June 2027");
    expect(formatDateRange("2027-06-19", "2027-06-19", "en")).toBe("19 June 2027");
    expect(formatDateRange("2027-06-19", "2027-06-20", "en")).toBe("19 June 2027 – 20 June 2027");
  });

  it("čas události je v pásmu svatby ve 24hodinovém tvaru", () => {
    expect(formatTime("2027-06-19T14:00:00+02:00", "cs", "Europe/Prague")).toBe("14:00");
    expect(formatTime("2027-06-19T14:00:00+02:00", "en", "Europe/Prague")).toBe("14:00");
    expect(formatTime("2027-06-19T12:00:00Z", "cs", "Europe/Prague")).toBe("14:00");
    expect(formatTime("2027-06-19T20:05:00+02:00", "en", "Europe/Prague")).toBe("20:05");
  });
});
