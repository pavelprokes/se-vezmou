import { seatPoints, type SeatingPlan } from "@/admin/seating/layout";

/**
 * Schematický plánek sálu (SVG): stoly s čísly a židle, obsazené plné. Bez háčků, takže ho použije
 * plánovač v prohlížeči i tisková stránka na serveru. Pro čtečku je to jeden obrázek s popisem
 * (`label`); stejné údaje jsou na stránce i jako seznam stolů.
 */
export function SeatingMap({
  plan,
  label,
  className,
}: {
  plan: Pick<SeatingPlan, "tables" | "assignments" | "width" | "height">;
  label: string;
  className?: string;
}) {
  if (plan.tables.length === 0) return null;
  const taken = new Set(Object.values(plan.assignments).map((a) => `${a.table}#${a.seat}`));
  const scale = Math.max(plan.width, plan.height) / 900;
  const font = Math.max(18, 22 * scale);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${plan.width} ${plan.height}`}
      className={className}
      data-testid="seating-map"
    >
      <rect
        x={0}
        y={0}
        width={plan.width}
        height={plan.height}
        fill="var(--color-parchment, #fff)"
      />
      {plan.tables.map((table) => {
        const short = /^t(\d+)$/.exec(table.id)?.[1] ?? table.label;
        return (
          <g key={table.id}>
            {table.shape === "round" ? (
              <circle
                cx={table.x}
                cy={table.y}
                r={table.w / 2}
                fill="var(--color-linen, #efebe1)"
                stroke="currentColor"
                strokeWidth={3}
              />
            ) : (
              <rect
                x={table.x - table.w / 2}
                y={table.y - table.h / 2}
                width={table.w}
                height={table.h}
                rx={6}
                fill="var(--color-linen, #efebe1)"
                stroke="currentColor"
                strokeWidth={3}
              />
            )}
            {seatPoints(table).map((point, index) => (
              <circle
                key={index}
                cx={point.x}
                cy={point.y}
                r={14}
                fill={taken.has(`${table.id}#${index + 1}`) ? "currentColor" : "transparent"}
                stroke="currentColor"
                strokeWidth={2.5}
              />
            ))}
            <text
              x={table.x}
              y={table.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={table.shape === "round" ? font * 1.4 : font}
              fill="currentColor"
              transform={table.h > table.w ? `rotate(-90 ${table.x} ${table.y})` : undefined}
            >
              {short}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
