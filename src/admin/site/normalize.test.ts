import { describe, expect, it } from "vitest";
import { normalizeHttpsUrl } from "./normalize";

describe("normalizeHttpsUrl: odkaz na externí galerii", () => {
  it("doplní https:// a normalizuje adresu", () => {
    expect(normalizeHttpsUrl("fotky.example/svatba")).toBe("https://fotky.example/svatba");
    expect(normalizeHttpsUrl("  https://fotky.example/a?b=1  ")).toBe(
      "https://fotky.example/a?b=1",
    );
    expect(normalizeHttpsUrl("HTTPS://Fotky.Example/")).toBe("https://fotky.example/");
    expect(normalizeHttpsUrl("fotky.example:443/a")).toBe("https://fotky.example/a");
  });

  it.each([
    "http://fotky.example/a",
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "ftp://fotky.example",
    "mailto:a@example.cz",
    "https://u:p@fotky.example/",
    "https://localhost/",
    "https://fotky/",
    "https://fotky.example./",
    "https://a b.example/",
    "",
    "   ",
    "https://",
  ])("odmítne %j", (value) => {
    expect(normalizeHttpsUrl(value)).toBeNull();
  });

  it("odmítne příliš dlouhý odkaz", () => {
    expect(normalizeHttpsUrl(`https://fotky.example/${"a".repeat(600)}`)).toBeNull();
  });
});
