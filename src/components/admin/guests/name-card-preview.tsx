import { DETAIL_SIZE_PT, PT_TO_MM, type FaceLayout } from "@/admin/name-cards/face";
import { ORNAMENTS, type CardStyle } from "@/admin/name-cards/style";

const FONT = {
  serif: { family: "var(--font-newsreader), Georgia, serif", weight: 500 },
  sans: { family: "var(--font-dm-sans), system-ui, sans-serif", weight: 700 },
} as const;

/**
 * Náhled přední strany jmenovky ve skutečném poměru stran (SVG v milimetrech). Kreslí stejné
 * rozvržení jako PDF (`faceLayout`), takže co je v náhledu, to se vytiskne. Jméno je skutečný text,
 * čtečka ho přečte jako název obrázku.
 */
export function NameCardPreview({
  face,
  style,
  label,
}: {
  face: FaceLayout;
  style: CardStyle;
  label: string;
}) {
  const ornament = ORNAMENTS[style.ornament];
  const font = FONT[style.font];
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${face.width} ${face.height}`}
      className="border-field-border block h-auto w-full border border-dashed bg-white"
    >
      {face.lines.map((line) => (
        <text
          key={line.y}
          x={line.x}
          y={line.y}
          textAnchor="middle"
          fontFamily={font.family}
          fontWeight={font.weight}
          fontSize={face.sizePt * PT_TO_MM}
          fill={style.name}
          aria-hidden="true"
        >
          {line.text}
        </text>
      ))}
      <g transform={`translate(${face.ornament.x} ${face.ornament.y})`} aria-hidden="true">
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
      {face.detail ? (
        <text
          x={face.detail.x}
          y={face.detail.y}
          textAnchor="middle"
          fontFamily={FONT.sans.family}
          fontSize={DETAIL_SIZE_PT * PT_TO_MM}
          fill={style.detail}
          aria-hidden="true"
        >
          {face.detail.text}
        </text>
      ) : null}
    </svg>
  );
}
