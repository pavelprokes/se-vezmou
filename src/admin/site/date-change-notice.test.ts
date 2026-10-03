import { describe, expect, it } from "vitest";
import { dateChangeNotice } from "./date-change-notice";

describe("dateChangeNotice", () => {
  it("vyplní text v každém jazyce webu s datem", () => {
    const notice = dateChangeNotice(["cs", "en"], "2027-06-12");
    expect(notice?.cs).toContain("Změna termínu");
    expect(notice?.cs).toMatch(/12\.\s*června\s*2027|12\.\s*6\.\s*2027/);
    expect(notice?.en).toContain("Change of date");
    expect(notice?.en).toContain("2027");
  });

  it("konec před začátkem se ignoruje, text ukáže jen začátek", () => {
    expect(dateChangeNotice(["en"], "2027-06-14", "2027-06-12")).toEqual(
      dateChangeNotice(["en"], "2027-06-14"),
    );
  });

  it("vynechá jazyky, které web nemá", () => {
    expect(Object.keys(dateChangeNotice(["cs"], "2027-06-12") ?? {})).toEqual(["cs"]);
  });

  it("bez platného data vrací null", () => {
    expect(dateChangeNotice(["cs"], "")).toBeNull();
    expect(dateChangeNotice(["cs"], null)).toBeNull();
    expect(dateChangeNotice(["cs"], "12. 6. 2027")).toBeNull();
  });
});
