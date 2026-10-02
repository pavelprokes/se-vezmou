import { qrMatrix, qrSvgPath } from "@/wizard/qr";

/**
 * QR kód jako inline SVG (černá na bílé s tichou zónou). Generuje se na serveru; adresa `otpauth://`
 * s tajným klíčem neopouští odpověď této stránky a nikam se neposílá. Klíč je vždy i textově vedle kódu.
 */
export function OtpQr({ payload, label }: { payload: string; label: string }) {
  const { size, path } = qrSvgPath(qrMatrix(payload));
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      className="border-hairline h-auto w-56 max-w-full border"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
