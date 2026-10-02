import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BLOCKED_SLUG_WORDS, EXTRA_RESERVED_SLUGS, RESERVED_SLUGS } from "@/config/reserved-slugs";
import {
  asciiFold,
  isReservedSlug,
  normalizeSlugInput,
  slugFromNames,
  slugPart,
  slugProblem,
  slugRevealsYear,
  SLUG_MAX,
  variantKind,
} from "./slug";

describe("asciiFold a slugPart", () => {
  it.each([
    ["Klára", "klara"],
    ["Matěj", "matej"],
    ["Žofie Řehořová", "zofie-rehorova"],
    ["Mařenka", "marenka"],
    ["Łukasz", "lukasz"],
    ["Straße", "strasse"],
    ["Zoë", "zoe"],
    ["  Anna-Marie  ", "anna-marie"],
    ["O'Brien", "o-brien"],
    ["--A--B--", "a-b"],
    ["???", ""],
  ])("%j -> %j", (input, expected) => {
    expect(slugPart(input)).toBe(expected);
  });

  it("asciiFold převádí diakritiku a malá písmena", () => {
    expect(asciiFold("ČEŠTINA Ďáblův úkol")).toBe("cestina dabluv ukol");
  });
});

describe("slugFromNames", () => {
  it("jména páru se spojí přes „a“ bez diakritiky", () => {
    expect(slugFromNames("Klára", "Matěj")).toBe("klara-a-matej");
    expect(slugFromNames("Klára", "Matěj", "en")).toBe("klara-and-matej");
  });

  it("jedno jméno nebo žádné", () => {
    expect(slugFromNames("Klára", "")).toBe("klara");
    expect(slugFromNames("", "Matěj")).toBe("matej");
    expect(slugFromNames("", "")).toBe("");
    expect(slugFromNames("???", "!!!")).toBe("");
  });

  it("dlouhá jména se zkrátí na nejvýše 63 znaků bez pomlčky na konci a ani dvou za sebou", () => {
    const long = "Anna Marie Kristýna Barbora Eliška Johana Žofie Terezie Alžběta Magdalena";
    const slug = slugFromNames(long, long);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(slug).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
    expect(slug).not.toContain("--");
    expect(slug).toContain("-a-");
    expect(slugProblem(slug)).toBeNull();
  });

  it("jedno velmi dlouhé jméno se krátí samo", () => {
    const slug = slugFromNames("A".repeat(90), "Matěj");
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(slug).toMatch(/-a-matej$/);
  });

  it("krátí jen to delší jméno a krátké nechává celé", () => {
    const slug = slugFromNames("Jan", "B".repeat(80));
    expect(slug.startsWith("jan-a-b")).toBe(true);
    expect(slug.length).toBe(SLUG_MAX);
  });
});

describe("normalizeSlugInput", () => {
  it("odstraní schéma a doménu", () => {
    expect(normalizeSlugInput("https://Klara-a-Matej.se-vezmou.cz/")).toBe("klara-a-matej");
    expect(normalizeSlugInput("klara-a-matej.se-vezmou.cz")).toBe("klara-a-matej");
    expect(normalizeSlugInput("klara-a-matej.localhost:3000")).toBe("klara-a-matej");
  });

  it("diakritika, mezery a nepovolené znaky se převedou", () => {
    expect(normalizeSlugInput("Klára a Matěj!")).toBe("klara-a-matej");
    expect(normalizeSlugInput("klara__matej")).toBe("klara-matej");
  });

  it("při psaní ponechá pomlčku na konci, při dokončení ji odstraní", () => {
    expect(normalizeSlugInput("klara-a-", { final: false })).toBe("klara-a-");
    expect(normalizeSlugInput("klara-a-", { final: true })).toBe("klara-a");
    expect(normalizeSlugInput("-klara", { final: false })).toBe("klara");
  });

  it("dvě pomlčky za sebou splyne na jednu", () => {
    expect(normalizeSlugInput("klara---matej")).toBe("klara-matej");
  });

  it("nepřekročí 63 znaků", () => {
    expect(normalizeSlugInput("a".repeat(100)).length).toBe(SLUG_MAX);
  });
});

describe("slugProblem", () => {
  it("platná adresa je v pořádku", () => {
    expect(slugProblem("klara-a-matej")).toBeNull();
    expect(slugProblem("abc")).toBeNull();
    expect(slugProblem("a".repeat(63))).toBeNull();
    expect(slugProblem("svatba2027")).toBeNull();
  });

  it.each([
    ["", "empty"],
    ["ab", "too_short"],
    ["a".repeat(64), "too_long"],
    ["-klara", "format"],
    ["klara-", "format"],
    ["klara--matej", "format"],
    ["Klara", "format"],
    ["klára", "format"],
    ["klara_matej", "format"],
    ["klara.matej", "format"],
  ])("%j -> %s", (slug, problem) => {
    expect(slugProblem(slug)).toBe(problem);
  });

  it("rezervovaná slova a blokované výrazy", () => {
    for (const word of [
      "www",
      "app",
      "admin",
      "api",
      "mail",
      "podpora",
      "status",
      "static",
      "cdn",
    ]) {
      expect(slugProblem(word), word).toBe("reserved");
    }
    expect(slugProblem("kurva-a-matej")).toBe("reserved");
    expect(slugProblem("moje-paypal-svatba")).toBe("reserved");
    expect(slugProblem("pop-a-dev")).toBeNull();
  });
});

describe("isReservedSlug", () => {
  it("díl kratší než čtyři znaky se neporovnává (ale celá adresa ano)", () => {
    expect(isReservedSlug("api")).toBe(true);
    expect(isReservedSlug("klara-a-api")).toBe(false);
    expect(isReservedSlug("klara-a-test")).toBe(true);
  });
});

describe("seznamy rezervovaných slov jsou shodné s databází", () => {
  const sql = (name: string) =>
    readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");

  function words(source: string, start: RegExp): string[] {
    const from = source.search(start);
    expect(from).toBeGreaterThan(-1);
    const rest = source.slice(from);
    const end = rest.search(/\]\)|on conflict/);
    return [...rest.slice(0, end).matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
  }

  it("blokované výrazy z migrace 20261002140000_wizard.sql", () => {
    const fromSql = words(sql("20261002140000_wizard.sql"), /unnest\(array\[/);
    expect([...fromSql].sort()).toEqual([...BLOCKED_SLUG_WORDS].sort());
  });

  it("rezervovaná slova z migrace seed", () => {
    const seed = sql("20261002120500_seed.sql");
    const from = seed.indexOf("insert into public.slug_registry");
    const fromSql = [...seed.slice(from).matchAll(/\('([a-z0-9-]+)', 'reserved_word'\)/g)].map(
      (m) => m[1],
    );
    expect([...fromSql].sort()).toEqual([...RESERVED_SLUGS, ...EXTRA_RESERVED_SLUGS].sort());
  });
});

describe("slugRevealsYear a variantKind", () => {
  it("adresa s rokem nebo rokem a měsícem prozradí rok svatby", () => {
    expect(slugRevealsYear("klara-a-matej-2027")).toBe(true);
    expect(slugRevealsYear("klara-a-matej-2027-06")).toBe(true);
    expect(slugRevealsYear("klara-a-matej")).toBe(false);
    expect(slugRevealsYear("klara-a-matej-obec")).toBe(false);
    expect(slugRevealsYear("klara-a-matej-k7m2")).toBe(false);
    expect(slugRevealsYear("svatba-3000")).toBe(false);
  });

  it("druh varianty podle koncovky", () => {
    expect(variantKind("klara-a-matej-2027")).toBe("year");
    expect(variantKind("klara-a-matej-2027-06")).toBe("month");
    expect(variantKind("klara-a-matej-obec")).toBe("place");
    expect(variantKind("klara-a-matej-k7m2")).toBe("random");
    expect(variantKind("klara-a-matej")).toBeNull();
  });
});
