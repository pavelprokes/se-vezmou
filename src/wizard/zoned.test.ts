import { describe, expect, it } from "vitest";
import { normalizePhone, normalizeUrl } from "./normalize";
import { addDays, endOfDayIso, todayIn, zonedIso } from "./zoned";

describe("zonedIso", () => {
  it("léto (UTC+2) a zima (UTC+1)", () => {
    expect(zonedIso("2027-06-19", "14:00")).toBe("2027-06-19T14:00:00+02:00");
    expect(zonedIso("2027-01-16", "14:00")).toBe("2027-01-16T14:00:00+01:00");
  });

  it("přechod na letní čas (poslední neděle v březnu 2027 je 28. 3.)", () => {
    expect(zonedIso("2027-03-28", "01:30")).toBe("2027-03-28T01:30:00+01:00");
    expect(zonedIso("2027-03-28", "04:00")).toBe("2027-03-28T04:00:00+02:00");
  });

  it("přechod na zimní čas (31. 10. 2027)", () => {
    expect(zonedIso("2027-10-31", "12:00")).toBe("2027-10-31T12:00:00+01:00");
    expect(zonedIso("2027-10-30", "12:00")).toBe("2027-10-30T12:00:00+02:00");
  });

  it("jiné pásmo", () => {
    expect(zonedIso("2027-06-19", "14:00", "Europe/London")).toBe("2027-06-19T14:00:00+01:00");
  });

  it("výsledek je platný ISO čas s posunem", () => {
    const iso = zonedIso("2027-06-19", "23:30");
    expect(new Date(iso).toISOString()).toBe("2027-06-19T21:30:00.000Z");
  });
});

describe("endOfDayIso, todayIn, addDays", () => {
  it("konec dne v pásmu svatby", () => {
    expect(endOfDayIso("2027-05-01")).toBe("2027-05-01T23:59:59+02:00");
    expect(endOfDayIso("2027-02-01")).toBe("2027-02-01T23:59:59+01:00");
  });

  it("dnešní datum v pásmu svatby (půlnoc UTC je v Praze už další den)", () => {
    expect(todayIn(new Date("2026-10-02T23:30:00Z"))).toBe("2026-10-03");
    expect(todayIn(new Date("2026-10-02T10:00:00Z"))).toBe("2026-10-02");
  });

  it("přičítání dnů přes hranici měsíce a roku", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });
});

describe("normalizeUrl", () => {
  it("doplní https a ponechá platné adresy", () => {
    expect(normalizeUrl("www.penzion.cz")).toBe("https://www.penzion.cz/");
    expect(normalizeUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(normalizeUrl("http://example.com")).toBe("http://example.com/");
  });

  it.each(["", "javascript:alert(1)", "ftp://example.com", "nesmysl", "data:text/html,x"])(
    "odmítne %j",
    (value) => {
      expect(normalizeUrl(value)).toBeNull();
    },
  );
});

describe("normalizePhone", () => {
  it("číslice a mezery projdou, oddělovače se převedou na mezery", () => {
    expect(normalizePhone("+420 777 123 456")).toBe("+420 777 123 456");
    expect(normalizePhone("777-123-456")).toBe("777 123 456");
    expect(normalizePhone("(777) 123.456")).toBe("777 123 456");
  });

  it.each(["", "abc", "12345", "+42077712345678901234567", "777 abc 456"])(
    "odmítne %j",
    (value) => {
      expect(normalizePhone(value)).toBeNull();
    },
  );
});
