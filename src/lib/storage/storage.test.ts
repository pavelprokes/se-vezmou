import { describe, expect, it } from "vitest";
import { getStorage, noopStorage, setStorage } from "./index";
import { createMemoryStorage } from "./memory";
import { weddingPrefix } from "./types";

const A = "0b6a1c1e-3b5e-4d0c-9a1f-0d3c7e9a1b11";
const B = "7c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5";

describe("předpona úložiště", () => {
  it("je {wedding_id}/ malými písmeny", () => {
    expect(weddingPrefix(A.toUpperCase())).toBe(`${A}/`);
  });

  it.each(["", "..", "../x", `${A}/../${B}`, "klara-a-matej", `${A}/`, "*"])(
    "odmítne neplatný identifikátor %j (nikdy se nemaže volná předpona)",
    (value) => {
      expect(() => weddingPrefix(value)).toThrow();
    },
  );
});

describe("úložiště v paměti", () => {
  it("výpis a mazání se týkají jen předpony jedné svatby", async () => {
    const storage = createMemoryStorage();
    storage.put(`${A}/foto/1.webp`, 10);
    storage.put(`${A}/foto/2.webp`, 20);
    storage.put(`${B}/foto/1.webp`, 30);
    expect(await storage.listPrefix(A)).toEqual([
      { key: `${A}/foto/1.webp`, bytes: 10 },
      { key: `${A}/foto/2.webp`, bytes: 20 },
    ]);
    expect(await storage.deletePrefix(A)).toEqual({ deleted: 2 });
    expect(storage.keys()).toEqual([`${B}/foto/1.webp`]);
    expect(await storage.deletePrefix(A)).toEqual({ deleted: 0 });
  });

  it("selhání mazání vyhodí chybu a nic nesmaže", async () => {
    const storage = createMemoryStorage();
    storage.put(`${A}/foto/1.webp`);
    storage.failDeleteFor.add(A);
    await expect(storage.deletePrefix(A)).rejects.toThrow();
    expect(storage.keys()).toHaveLength(1);
    storage.failDeleteFor.clear();
    expect(await storage.deletePrefix(A)).toEqual({ deleted: 1 });
  });
});

describe("výchozí úložiště", () => {
  it("do M7c nic neuchovává: výpis je prázdný a mazání uspěje", async () => {
    expect(await noopStorage.listPrefix(A)).toEqual([]);
    expect(await noopStorage.deletePrefix(A)).toEqual({ deleted: 0 });
    await expect(noopStorage.deletePrefix("")).rejects.toThrow();
  });

  it("jde nahradit pro test a vrátit", () => {
    const storage = createMemoryStorage();
    setStorage(storage);
    expect(getStorage()).toBe(storage);
    setStorage(null);
    expect(getStorage()).toBe(noopStorage);
  });
});
