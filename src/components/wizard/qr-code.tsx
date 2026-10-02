import { qrMatrix, qrSvgPath } from "@/wizard/qr";

/** QR kód jako inline SVG: černá na bílé s tichou zónou, aby šel načíst na každém pozadí. */
export function QrCode({
  payload,
  label,
  className,
}: {
  payload: string;
  /** Popis pro čtečky obrazovky (WCAG 1.1.1): co kód obsahuje. */
  label: string;
  className?: string;
}) {
  const { size, path } = qrSvgPath(qrMatrix(payload));
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
