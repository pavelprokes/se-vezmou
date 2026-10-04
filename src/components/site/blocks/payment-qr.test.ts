import { describe, expect, it } from "vitest";
import { utf8ByteString } from "./payment-qr";

describe("UTF-8 do QR", () => {
  it("diakritika jako bajty UTF-8, ASCII beze změny", () => {
    expect(utf8ByteString("SPD*1.0")).toBe("SPD*1.0");
    expect([...utf8ByteString("á")].map((c) => c.charCodeAt(0))).toEqual([0xc3, 0xa1]);
  });
});
