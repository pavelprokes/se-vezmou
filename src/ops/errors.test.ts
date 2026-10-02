import { describe, expect, it } from "vitest";
import { DbError } from "@/lib/db/transport";
import { opsErrorField, opsErrorKey } from "./errors";

describe("opsErrorKey", () => {
  it("identifikátory chyb z funkcí op_* se převedou na klíče", () => {
    expect(opsErrorKey(new DbError("f", "22023", "reason_required"))).toBe("reason");
    expect(opsErrorKey(new DbError("f", "23505", "slug_unavailable"))).toBe("slugUnavailable");
    expect(opsErrorKey(new DbError("f", "22023", "invalid_slug"))).toBe("invalidSlug");
    expect(opsErrorKey(new DbError("f", "22023", "not_an_extension"))).toBe("notExtension");
    expect(opsErrorKey(new DbError("f", "55000", "not_restorable"))).toBe("notRestorable");
    expect(opsErrorKey(new DbError("f", "55000", "cannot_publish"))).toBe("cannotPublish");
    expect(opsErrorKey(new DbError("f", "55000", "use_restore"))).toBe("useRestore");
    expect(opsErrorKey(new DbError("f", "P0002", "wedding_not_found"))).toBe("notFound");
    expect(opsErrorKey(new DbError("f", "42501", "operator_forbidden"))).toBe("forbidden");
  });

  it("kód chyby bez identifikátoru: oprávnění, nenalezeno, duplicita; jinak obecná chyba", () => {
    expect(opsErrorKey(new DbError("f", "42501", "chyba SQL"))).toBe("forbidden");
    expect(opsErrorKey(new DbError("f", "P0002", "chyba SQL"))).toBe("notFound");
    expect(opsErrorKey(new DbError("f", "23505", "chyba SQL"))).toBe("duplicate");
    expect(opsErrorKey(new DbError("f", "XX000", "chyba SQL"))).toBe("generic");
    expect(opsErrorKey(new Error("cokoli, třeba jméno Jan Novák"))).toBe("generic");
    expect(opsErrorKey("text")).toBe("generic");
  });

  it("pole formuláře podle chyby", () => {
    expect(opsErrorField("reason")).toBe("reason");
    expect(opsErrorField("slugUnavailable")).toBe("slug");
    expect(opsErrorField("notExtension")).toBe("until");
    expect(opsErrorField("invalidNote")).toBe("body");
    expect(opsErrorField("duplicate")).toBe("email");
    expect(opsErrorField("forbidden")).toBeUndefined();
  });
});
