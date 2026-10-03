import type { ReactNode } from "react";
import type { SurfaceKey } from "@/site/themes/palettes";

/**
 * Primitiva šablony Eukalyptus. Dekorace (větvička, věnec) jsou inline SVG, vždy `aria-hidden`, barvy jen
 * z dekorativních rolí palety přes CSS proměnné (`--eu-leaf-*`). Tvar se počítá deterministicky (žádné
 * `Math.random`), aby server i prohlížeč vykreslily totéž.
 */

const hidden = { "aria-hidden": true, focusable: false } as const;

/** Bod a tečna kubické Bézierovy křivky v parametru `t`. */
function bezier(
  [p0, p1, p2, p3]: readonly (readonly [number, number])[],
  t: number,
): { x: number; y: number; angle: number } {
  const u = 1 - t;
  const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
  const y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
  const dx =
    3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
  const dy =
    3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
  return { x, y, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Kulatý eukalyptový lístek se špičkou (počátek v místě úchytu na stonku). */
const LEAF = "M0 0 C 8 -22 38 -30 58 -14 C 70 -4 66 14 50 20 C 30 27 8 16 0 0 Z";

const STEM = [
  [36, 592],
  [70, 400],
  [230, 300],
  [306, 24],
] as const;

/** Rozmístění lístků po stonku: parametr, strana, velikost, odstín (1 až 3). */
const SPRIG_LEAVES: readonly [number, 1 | -1, number, 1 | 2 | 3][] = Array.from(
  { length: 22 },
  (_, i) => {
    const t = 0.06 + i * 0.042;
    const side = i % 2 === 0 ? 1 : -1;
    // Lístky ke špičce menší; odstíny se střídají v pevném vzoru (bez náhody).
    const scale = 0.62 - t * 0.36;
    const shade = ([1, 2, 1, 3, 2, 1, 2] as const)[i % 7];
    return [t, side, scale, shade] as const;
  },
);

/**
 * Eukalyptová větvička (dekor). `variant` mění kombinaci barev lístků; zrcadlení a velikost řeší CSS.
 */
export function Sprig({ className, variant = 1 }: { className?: string; variant?: 1 | 2 }) {
  return (
    <svg {...hidden} viewBox="0 0 340 600" className={`eu-sprig ${className ?? ""}`}>
      <path
        className="eu-stem"
        d={`M${STEM[0].join(" ")} C ${STEM[1].join(" ")} ${STEM[2].join(" ")} ${STEM[3].join(" ")}`}
        fill="none"
      />
      {SPRIG_LEAVES.map(([t, side, scale, shade], index) => {
        const { x, y, angle } = bezier(STEM, t);
        const tone = variant === 2 ? (((shade % 3) + 1) as 1 | 2 | 3) : shade;
        return (
          <path
            key={index}
            className={`eu-leaf-${tone}`}
            d={LEAF}
            transform={`translate(${round(x)} ${round(y)}) rotate(${round(angle + side * 55)}) scale(${scale} ${side * scale})`}
          />
        );
      })}
    </svg>
  );
}

/** Věnec z lístků (dekor kolem nadpisu darů). */
export function Wreath({ className }: { className?: string }) {
  const count = 28;
  return (
    <svg {...hidden} viewBox="0 0 400 400" className={`eu-wreath ${className ?? ""}`}>
      <circle className="eu-stem" cx="200" cy="200" r="150" fill="none" />
      {Array.from({ length: count }, (_, index) => {
        const deg = (index / count) * 360;
        const rad = (deg * Math.PI) / 180;
        const side = index % 2 === 0 ? 1 : -1;
        const x = 200 + 150 * Math.cos(rad);
        const y = 200 + 150 * Math.sin(rad);
        const scale = 0.62 + (index % 3) * 0.08;
        return (
          <path
            key={index}
            className={`eu-leaf-${(index % 3) + 1}`}
            d={LEAF}
            transform={`translate(${round(x)} ${round(y)}) rotate(${round(deg + 90 + side * 48)}) scale(${scale} ${side * scale})`}
          />
        );
      })}
    </svg>
  );
}

/** Malý popisek velkými písmeny (index sekce, štítek nad jmény). */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={`eu-label ${className ?? ""}`}>{children}</p>;
}

/** Text s posledním slovem kurzívou v barvě akcentu („Potvrdit *účast*“); jedno slovo zůstane beze změny. */
export function ItalicLast({ text }: { text: string }) {
  const at = text.trimEnd().lastIndexOf(" ");
  if (at <= 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)} <em className="eu-em">{text.slice(at + 1)}</em>
    </>
  );
}

/** Barevná plocha sekce s kotvou a rytmem odsazení; plocha nastaví barvy (`data-tone`). */
export function SectionShell({
  id,
  tone,
  labelledBy,
  className,
  part,
  children,
}: {
  id: string;
  tone: SurfaceKey;
  labelledBy: string;
  className?: string;
  /** Druh části pro styly (`data-part`). */
  part: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={`eu-section ${className ?? ""}`}
      data-tone={tone}
      data-part={part}
    >
      {children}
    </section>
  );
}

/** Index sekce („II — 10. dubna“) a obří nadpis druhé úrovně s posledním slovem kurzívou. */
export function SectionHead({
  id,
  index,
  meta,
  title,
  className,
}: {
  id: string;
  index?: string;
  meta?: ReactNode;
  title: string;
  className?: string;
}) {
  return (
    <header className={`eu-head ${className ?? ""}`}>
      {index || meta ? (
        <Label>
          {index}
          {index && meta ? " — " : null}
          {meta}
        </Label>
      ) : null}
      <h2 id={id} className="eu-h2">
        <ItalicLast text={title} />
      </h2>
    </header>
  );
}
