import qrcode from "qrcode-generator";

/**
 * Text jako bajty UTF-8, každý bajt jeden znak: `qrcode-generator` bere z každého znaku jen dolní bajt,
 * takže diakritika (EPC QR deklaruje UTF-8, „Klára“) by se jinak poškodila. ASCII (SPAYD) zůstává beze změny.
 */
export function utf8ByteString(text: string): string {
  return Array.from(new TextEncoder().encode(text), (byte) => String.fromCharCode(byte)).join("");
}

/** QR kód platby jako inline SVG (černá na bílé s tichou zónou, aby šel načíst v každé paletě). */
export function PaymentQr({ payload, label }: { payload: string; label: string }) {
  const qr = qrcode(0, "M");
  qr.addData(utf8ByteString(payload), "Byte");
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 4;
  let path = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  const size = count + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      className="site-qr"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
