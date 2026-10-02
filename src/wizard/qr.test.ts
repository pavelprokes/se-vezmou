import { describe, expect, it } from "vitest";
import { qrMatrix, qrSvgPath, QR_QUIET_ZONE } from "./qr";

describe("qrMatrix", () => {
  const url = "https://klara-a-matej.se-vezmou.cz/";

  it("čtvercová matice odpovídající verzi QR kódu", () => {
    const matrix = qrMatrix(url);
    expect(matrix.dark).toHaveLength(matrix.count);
    expect(matrix.dark.every((row) => row.length === matrix.count)).toBe(true);
    // verze 1 je 21 × 21, každá další přidá 4
    expect((matrix.count - 17) % 4).toBe(0);
    expect(matrix.count).toBeGreaterThanOrEqual(21);
  });

  it("má vyhledávací čtverce ve třech rozích (tmavý okraj 7 × 7)", () => {
    const { dark, count } = qrMatrix(url);
    for (const [row, col] of [
      [0, 0],
      [0, count - 7],
      [count - 7, 0],
    ]) {
      for (let i = 0; i < 7; i++) {
        expect(dark[row][col + i]).toBe(true);
        expect(dark[row + 6][col + i]).toBe(true);
        expect(dark[row + i][col]).toBe(true);
        expect(dark[row + i][col + 6]).toBe(true);
      }
    }
  });

  it("je deterministická a různé adresy dávají různé kódy", () => {
    expect(qrMatrix(url).dark).toEqual(qrMatrix(url).dark);
    expect(qrMatrix(url).dark).not.toEqual(qrMatrix("https://jina-adresa.se-vezmou.cz/").dark);
  });
});

describe("qrSvgPath", () => {
  it("tichá zóna 4 moduly, každý tmavý modul je čtverec 1 × 1", () => {
    const matrix = qrMatrix("https://a.se-vezmou.cz/");
    const { size, path } = qrSvgPath(matrix);
    expect(size).toBe(matrix.count + QR_QUIET_ZONE * 2);
    const squares = path.match(/M\d+ \d+h1v1h-1z/g) ?? [];
    const dark = matrix.dark.flat().filter(Boolean).length;
    expect(squares).toHaveLength(dark);
    // první vyhledávací čtverec začíná v pravém horním rohu tiché zóny
    expect(path.startsWith(`M${QR_QUIET_ZONE} ${QR_QUIET_ZONE}h1v1h-1z`)).toBe(true);
  });
});
