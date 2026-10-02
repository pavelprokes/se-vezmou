import qrcode from "qrcode-generator";

/**
 * QR kód z adresy webu, generovaný lokálně (žádná služba třetí strany, adresa neopouští server
 * ani prohlížeč). Matice modulů se kreslí vektorově jak na obrazovce (SVG), tak v PDF k tisku.
 */

export interface QrMatrix {
  /** Počet modulů na straně (bez tiché zóny). */
  count: number;
  /** `dark[řádek][sloupec]`. */
  dark: boolean[][];
}

/** Úroveň opravy chyb M (15 %): dost na tisk a drobné poškození, QR zůstává čitelný. */
export function qrMatrix(payload: string): QrMatrix {
  const qr = qrcode(0, "M");
  qr.addData(payload);
  qr.make();
  const count = qr.getModuleCount();
  const dark: boolean[][] = [];
  for (let row = 0; row < count; row++) {
    const cells: boolean[] = [];
    for (let col = 0; col < count; col++) cells.push(qr.isDark(row, col));
    dark.push(cells);
  }
  return { count, dark };
}

/** Tichá zóna kolem kódu v modulech (norma žádá 4). */
export const QR_QUIET_ZONE = 4;

/** Cesta SVG: každý tmavý modul je čtverec 1 × 1 s posunem o tichou zónu. */
export function qrSvgPath(matrix: QrMatrix, quiet = QR_QUIET_ZONE): { size: number; path: string } {
  let path = "";
  matrix.dark.forEach((cells, row) =>
    cells.forEach((isDark, col) => {
      if (isDark) path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }),
  );
  return { size: matrix.count + quiet * 2, path };
}
