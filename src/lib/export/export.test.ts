import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { csvCell, neutralizeFormula, toCsv } from "./csv";
import { buildGuestTable } from "./table";
import { guestExportSchema, type GuestExport } from "./types";
import { toXlsx } from "./xlsx";

const E1 = "e1000000-0000-4000-8000-000000000001";
const E2 = "e2000000-0000-4000-8000-000000000002";

const sample = (overrides: Partial<GuestExport> = {}): GuestExport => ({
  wedding: {
    partner_a_name: "Klára",
    partner_b_name: "Matěj",
    starts_on: "2027-06-12",
    default_locale: "cs",
  },
  include_health: false,
  events: [
    { id: E1, title: { cs: "Obřad", en: "Ceremony" }, starts_at: "2027-06-12T11:00:00Z" },
    { id: E2, title: { cs: "Hostina" }, starts_at: "2027-06-12T15:00:00Z" },
  ],
  questions: [
    { key: "lodging", type: "text", label: { cs: "Ubytování" }, options: null },
    { key: "bus", type: "bool", label: { cs: "Autobus", en: "Bus" }, options: null },
    {
      key: "menu",
      type: "choice",
      label: { cs: "Menu", en: "Menu" },
      options: [
        { value: "meat", label: { cs: "Maso", en: "Meat" } },
        { value: "veg", label: { cs: "Vegetariánské", en: "Vegetarian" } },
      ],
    },
  ],
  people: [
    {
      household: "Rodina Novákova",
      name: "Jan Novák",
      kind: "guest",
      age: null,
      invited_event_ids: [E1, E2],
      answered: true,
      attendance: [
        { event_id: E1, attending: true },
        { event_id: E2, attending: false },
      ],
      submitted_at: "2027-03-01T09:30:45Z",
      entered_by: "guest",
      contact_email: "jan@example.test",
      answers: { lodging: "need", bus: true, menu: "veg", song: "Hallelujah" },
      diet: null,
      allergies: null,
    },
    {
      household: "Rodina Novákova",
      name: "Marie Nováková",
      kind: "guest",
      age: null,
      invited_event_ids: [E1],
      answered: false,
      attendance: [],
      submitted_at: null,
      entered_by: null,
      contact_email: null,
      answers: {},
      diet: null,
      allergies: null,
    },
    {
      household: null,
      name: '=HYPERLINK("http://zlo.example")',
      kind: "unlisted",
      age: 7,
      invited_event_ids: [],
      answered: true,
      attendance: [{ event_id: E1, attending: true }],
      submitted_at: "2027-03-02T10:00:00Z",
      entered_by: "guest",
      contact_email: null,
      answers: {},
      diet: null,
      allergies: null,
    },
  ],
  ...overrides,
});

describe("CSV", () => {
  it.each([
    ["=1+1", "'=1+1"],
    ["+420 777 123 456", "'+420 777 123 456"],
    ["-5", "'-5"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tx", "'\tx"],
    ["\rx", "'\rx"],
    ["Jan Novák", "Jan Novák"],
    ["a=b", "a=b"],
    ["", ""],
  ])("neutralizace vzorce %j", (input, expected) => {
    expect(neutralizeFormula(input)).toBe(expected);
  });

  it("buňky: uvozovky se zdvojí, oddělovač a konce řádků se uzavřou do uvozovek, číslo se nepřepisuje", () => {
    expect(csvCell('řekl "ano"')).toBe('"řekl ""ano"""');
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell("řádek\nřádek")).toBe('"řádek\nřádek"');
    expect(csvCell(7)).toBe("7");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(null)).toBe("");
  });

  it("soubor má BOM UTF-8, středníky, CRLF a koncový konec řádku", () => {
    const buffer = toCsv({
      headers: ["Jméno", "Věk"],
      rows: [
        ["Žofie", 7],
        ["=cmd", null],
      ],
    });
    const text = buffer.toString("utf8");
    expect(text.startsWith("﻿")).toBe(true);
    expect(text.slice(1)).toBe("Jméno;Věk\r\nŽofie;7\r\n'=cmd;\r\n");
  });
});

describe("tabulka hostů a RSVP", () => {
  it("česky: sloupec na událost a otázku, stav po hostech, vzorec ve jménu zůstane textem", () => {
    const table = buildGuestTable(sample(), "cs");
    expect(table.name).toBe("Hosté a RSVP");
    expect(table.headers).toEqual([
      "Domácnost",
      "Jméno",
      "Typ",
      "Věk",
      "Odpověděl(a)",
      "Obřad",
      "Hostina",
      "Ubytování",
      "Píseň",
      "Autobus",
      "Menu",
      "Kontaktní e-mail",
      "Odpověď odeslána",
      "Zadal(a)",
    ]);
    expect(table.rows[0]).toEqual([
      "Rodina Novákova",
      "Jan Novák",
      "Host",
      null,
      "ano",
      "přijde",
      "nepřijde",
      "potřebuje",
      "Hallelujah",
      "ano",
      "Vegetariánské",
      "jan@example.test",
      "2027-03-01 09:30",
      "host",
    ]);
    // neodpověděl(a): pozván na obřad, na hostinu není pozván
    expect(table.rows[1].slice(4, 7)).toEqual(["ne", "neodpověděl(a)", "nepozván(a)"]);
    // host mimo seznam: bez domácnosti a bez pozvání, ale s odpovědí
    expect(table.rows[2].slice(0, 7)).toEqual([
      "(mimo seznam)",
      '=HYPERLINK("http://zlo.example")',
      "Host mimo seznam",
      7,
      "ano",
      "přijde",
      "",
    ]);
  });

  it("anglicky: popisky a texty možností podle jazyka správce, název události z jazyka s náhradou", () => {
    const table = buildGuestTable(sample(), "en");
    expect(table.name).toBe("Guests and RSVP");
    expect(table.headers.slice(0, 7)).toEqual([
      "Household",
      "Name",
      "Type",
      "Age",
      "Replied",
      "Ceremony",
      "Hostina",
    ]);
    expect(table.rows[0].slice(4)).toEqual([
      "yes",
      "attending",
      "not attending",
      "needed",
      "Hallelujah",
      "yes",
      "Vegetarian",
      "jan@example.test",
      "2027-03-01 09:30",
      "guest",
    ]);
  });

  it("sloupce pro zdravotní údaje jsou jen na výslovnou žádost", () => {
    const without = buildGuestTable(sample(), "cs");
    expect(without.headers).not.toContain("Dieta");
    expect(without.headers).not.toContain("Alergie");

    const withHealth = buildGuestTable(
      sample({
        include_health: true,
        people: sample().people.map((p, i) =>
          i === 0 ? { ...p, diet: "vegetariánská", allergies: "ořechy" } : p,
        ),
      }),
      "cs",
    );
    expect(withHealth.headers.slice(-2)).toEqual(["Dieta", "Alergie"]);
    expect(withHealth.rows[0].slice(-2)).toEqual(["vegetariánská", "ořechy"]);
  });

  it("vestavěné otázky, na které nikdo neodpověděl, sloupec nemají", () => {
    const table = buildGuestTable(
      sample({ people: sample().people.map((p) => ({ ...p, answers: {} })) }),
      "cs",
    );
    expect(table.headers).not.toContain("Ubytování");
    expect(table.headers).not.toContain("Píseň");
  });

  it("prázdný seznam hostů dá tabulku jen se záhlavím", () => {
    const table = buildGuestTable(sample({ people: [] }), "cs");
    expect(table.rows).toEqual([]);
    expect(table.headers.length).toBeGreaterThan(5);
  });

  it("schéma odpovědi databáze odmítne cizí tvar", () => {
    expect(() => guestExportSchema.parse({ people: "x" })).toThrow();
    expect(guestExportSchema.parse(sample())).toEqual(sample());
  });
});

describe("Excel", () => {
  it("vytvoří platný .xlsx, text nikdy nepřevede na vzorec a nese diakritiku", async () => {
    const table = buildGuestTable(sample(), "cs");
    const buffer = await toXlsx(table);
    // XLSX je ZIP: začíná podpisem PK
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    const files = unzipSync(new Uint8Array(buffer));
    const names = Object.keys(files);
    expect(names).toContain("[Content_Types].xml");
    expect(names.some((name) => name.startsWith("xl/worksheets/"))).toBe(true);
    const all = names.map((name) => strFromU8(files[name])).join("\n");
    expect(all).toContain("Nováková");
    expect(all).toContain("Hosté a RSVP");
    // vzorec z formuláře hosta zůstal textem: v listu není žádný element vzorce <f>
    const sheets = names
      .filter((name) => name.startsWith("xl/worksheets/"))
      .map((name) => strFromU8(files[name]));
    expect(sheets.every((xml) => !/<f[ >]/.test(xml))).toBe(true);
    expect(all).toContain("HYPERLINK");
  });
});

const rpc = vi.hoisted(() => ({ tenantRpc: vi.fn() }));
vi.mock("@/lib/db/rpc", () => rpc);

afterEach(() => {
  rpc.tenantRpc.mockReset();
});

describe("služba exportu", () => {
  const session = {
    weddingId: "0b6a1c1e-3b5e-4d0c-9a1f-0d3c7e9a1b11",
    subjectId: "a1000000-0000-4000-8000-000000000001",
  };

  it("volá databázi jako správce své svatby a vrací CSV s názvem souboru podle dne", async () => {
    rpc.tenantRpc.mockResolvedValue(sample());
    const { exportGuestsAndRsvp } = await import("./service");
    const file = await exportGuestsAndRsvp(session, {
      format: "csv",
      locale: "cs",
      now: new Date("2027-06-20T10:00:00Z"),
    });
    expect(rpc.tenantRpc).toHaveBeenCalledWith(
      { weddingId: session.weddingId, weddingRole: "admin", subject: session.subjectId },
      "admin_export_guests",
      { p_include_health: false },
    );
    expect(file.filename).toBe("hoste-a-rsvp-2027-06-20.csv");
    expect(file.contentType).toBe("text/csv; charset=utf-8");
    expect(file.body.toString("utf8")).toContain("Jan Novák");
    // název souboru nenese jména
    expect(file.filename).not.toMatch(/Novák|Klára/);
  });

  it("Excel a zdravotní údaje jen na žádost; anglický název souboru", async () => {
    rpc.tenantRpc.mockResolvedValue(sample({ include_health: true }));
    const { exportGuestsAndRsvp } = await import("./service");
    const file = await exportGuestsAndRsvp(session, {
      format: "xlsx",
      locale: "en",
      includeHealth: true,
      now: new Date("2027-06-20T10:00:00Z"),
    });
    expect(rpc.tenantRpc.mock.calls[0][2]).toEqual({ p_include_health: true });
    expect(file.filename).toBe("guests-and-rsvp-2027-06-20.xlsx");
    expect(file.contentType).toContain("spreadsheetml");
    expect(file.body.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("odpověď databáze cizího tvaru export zastaví", async () => {
    rpc.tenantRpc.mockResolvedValue({ people: [{ name: 1 }] });
    const { exportGuestsAndRsvp } = await import("./service");
    await expect(exportGuestsAndRsvp(session, { format: "csv", locale: "cs" })).rejects.toThrow();
  });
});

describe("export fotografií (rozhraní, TODO M7c)", () => {
  it("zatím jen vypíše soubory svatby z úložiště a archiv nesestavuje", async () => {
    const { createMemoryStorage } = await import("@/lib/storage/memory");
    const { setStorage } = await import("@/lib/storage");
    const { planPhotoExport } = await import("./photos");
    const wedding = "0b6a1c1e-3b5e-4d0c-9a1f-0d3c7e9a1b11";
    const storage = createMemoryStorage();
    storage.put(`${wedding}/foto/1.webp`);
    storage.put("7c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5/foto/1.webp");
    setStorage(storage);
    try {
      expect(await planPhotoExport(wedding)).toEqual({ status: "not_available", files: 1 });
    } finally {
      setStorage(null);
    }
  });
});
