import { PT_TO_MM } from "@/admin/name-cards/face";
import { ORNAMENTS, type CardStyle } from "@/admin/name-cards/style";
import type { SignFont, SignLayout, SignTone } from "@/admin/gallery-sign/layout";
import { qrMatrix, qrSvgPath } from "@/wizard/qr";

const FONT: Record<SignFont, { family: string; weight: number }> = {
  display: { family: "var(--font-newsreader), Georgia, serif", weight: 500 },
  sans: { family: "var(--font-dm-sans), system-ui, sans-serif", weight: 400 },
  bold: { family: "var(--font-dm-sans), system-ui, sans-serif", weight: 700 },
};

function toneColor(style: CardStyle, tone: SignTone): string {
  if (tone === "name") return style.name;
  if (tone === "accent") return style.ornamentColor;
  return style.detail;
}

/**
 * Náhled cedulky ve skutečném poměru stran (SVG v milimetrech) ze stejného rozvržení jako PDF.
 * Čtečka přečte jen popisek obrázku; texty cedulky jsou pod náhledem i jako obyčejný text.
 */
export function GallerySignPreview({
  layout,
  style,
  qrUrl,
  label,
}: {
  layout: SignLayout;
  style: CardStyle;
  qrUrl: string;
  label: string;
}) {
  const ornament = ORNAMENTS[style.ornament];
  const display = style.font === "sans" ? FONT.bold : FONT.display;
  const qr = qrSvgPath(qrMatrix(qrUrl));
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className="border-field-border block h-auto w-full border border-dashed bg-white"
    >
      <g
        transform={`translate(${layout.ornament.x} ${layout.ornament.y}) scale(${layout.ornament.scale})`}
        aria-hidden="true"
      >
        {ornament.paths.map((path) =>
          path.mode === "fill" ? (
            <path key={path.d} d={path.d} fill={style.ornamentColor} />
          ) : (
            <path
              key={path.d}
              d={path.d}
              fill="none"
              stroke={style.ornamentColor}
              strokeWidth={path.strokeWidth ?? 0.2}
            />
          ),
        )}
      </g>
      {layout.texts.map((line) => {
        const font = line.font === "display" ? display : FONT[line.font];
        return (
          <text
            key={`${line.y}-${line.text}`}
            x={line.x}
            y={line.y}
            textAnchor="middle"
            fontFamily={font.family}
            fontWeight={font.weight}
            fontSize={line.sizePt * PT_TO_MM}
            fill={toneColor(style, line.tone)}
            aria-hidden="true"
          >
            {line.text}
          </text>
        );
      })}
      <svg
        x={layout.qr.x}
        y={layout.qr.y}
        width={layout.qr.size}
        height={layout.qr.size}
        viewBox={`0 0 ${qr.size} ${qr.size}`}
        aria-hidden="true"
        shapeRendering="crispEdges"
      >
        <rect width={qr.size} height={qr.size} fill="#fff" />
        <path d={qr.path} fill="#000" />
      </svg>
    </svg>
  );
}
