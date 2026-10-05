/**
 * Dekorativní inline SVG šablon. Vždy `aria-hidden`, nikdy nenese sdělení ani text; barvy jen
 * z dekorativních rolí palety (`ornament`, `decor`, `decor2`), které test kontrastu označuje
 * jako „jen dekor“. Výjimka: Deco kreslí linky v barvě `accent` (role pro ikony a linky, 3 : 1). Pozicují se pod textem (`z-index` 0) a nereagují na ukazatel.
 */

const common = { "aria-hidden": true, focusable: false } as const;

/** Monogram v kruhu s dvojitou linkou (jen Chateau); iniciály jsou dekor, jména jsou v nadpisu. */
export function Monogram({ a, b }: { a: string; b: string }) {
  const first = a.trim().charAt(0).toUpperCase();
  const second = b.trim().charAt(0).toUpperCase();
  return (
    <svg {...common} viewBox="0 0 160 160" className="site-monogram">
      <circle className="site-monogram-ring" cx="80" cy="80" r="76" fill="none" />
      <circle className="site-monogram-ring-inner" cx="80" cy="80" r="68" fill="none" />
      <text
        className="site-monogram-text"
        x="80"
        y="94"
        textAnchor="middle"
        fontSize="46"
        fontFamily="var(--font-newsreader), Georgia, serif"
      >
        {first}&amp;{second}
      </text>
    </svg>
  );
}

/** Oddělovač sekcí Chateau: linka s kosočtvercem. */
export function ChateauDivider() {
  return (
    <svg {...common} viewBox="0 0 200 16" className="site-divider">
      <path className="site-divider-line" d="M0 8 H82 M118 8 H200" fill="none" />
      <path className="site-divider-gem" d="M100 1 L107 8 L100 15 L93 8 Z" />
    </svg>
  );
}

/** Statek: klas s zrny po obou stranách stébla. */
export function StatekDivider() {
  const grains = [70, 82, 94, 106, 118, 130];
  return (
    <svg {...common} viewBox="0 0 200 24" className="site-divider">
      <path className="site-divider-line" d="M10 12 H190" fill="none" />
      {grains.map((x) => (
        <g key={x} className="site-divider-gem">
          <ellipse cx={x} cy={7} rx={5} ry={2.4} transform={`rotate(-28 ${x} 7)`} />
          <ellipse cx={x} cy={17} rx={5} ry={2.4} transform={`rotate(28 ${x} 17)`} />
        </g>
      ))}
      <ellipse className="site-divider-gem" cx={140} cy={12} rx={6} ry={2.6} />
    </svg>
  );
}

/** Vinice: úponek révy s listem a hroznem uprostřed. */
export function ViniceDivider() {
  return (
    <svg {...common} viewBox="0 0 200 28" className="site-divider">
      <path
        className="site-divider-line"
        d="M0 14 C30 4 50 24 80 14 M120 14 C150 4 170 24 200 14 M70 12 c-6 -8 4 -12 6 -4"
        fill="none"
      />
      {[
        [94, 8],
        [106, 8],
        [100, 14],
        [88, 14],
        [112, 14],
        [94, 20],
        [106, 20],
        [100, 26],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} className="site-divider-gem" cx={cx} cy={cy - 2} r={4} />
      ))}
    </svg>
  );
}

/** Vinice: malý hrozen nad jmény. */
export function ViniceCrest() {
  return (
    <svg {...common} viewBox="0 0 60 64" className="site-crest">
      <path className="site-divider-line" d="M30 2 V12 M30 8 c8 -8 18 -2 16 6" fill="none" />
      {[
        [22, 18],
        [30, 18],
        [38, 18],
        [26, 26],
        [34, 26],
        [18, 26],
        [42, 26],
        [22, 34],
        [30, 34],
        [38, 34],
        [26, 42],
        [34, 42],
        [30, 50],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} className="site-divider-gem" cx={cx} cy={cy} r={4.2} />
      ))}
    </svg>
  );
}

function Flower({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g>
      {[0, 72, 144, 216, 288].map((angle) => (
        <ellipse
          key={angle}
          className="site-flower-petal"
          cx={x}
          cy={y - r}
          rx={r * 0.55}
          ry={r}
          transform={`rotate(${angle} ${x} ${y})`}
        />
      ))}
      <circle className="site-flower-heart" cx={x} cy={y} r={r * 0.45} />
    </g>
  );
}

/** Louka: řádek lučních kvítků. */
export function LoukaDivider() {
  return (
    <svg {...common} viewBox="0 0 200 24" className="site-divider">
      <path className="site-divider-line" d="M0 12 H70 M130 12 H200" fill="none" />
      <Flower x={84} y={12} r={4} />
      <Flower x={100} y={12} r={6} />
      <Flower x={116} y={12} r={4} />
    </svg>
  );
}

/** Louka: kvítí v rozích úvodu (jen dekor, pod textem). */
export function LoukaBackdrop() {
  return (
    <>
      <svg {...common} viewBox="0 0 90 90" className="site-backdrop site-backdrop-start">
        <Flower x={26} y={30} r={10} />
        <Flower x={60} y={16} r={6} />
        <Flower x={16} y={68} r={5} />
      </svg>
      <svg {...common} viewBox="0 0 90 90" className="site-backdrop site-backdrop-end">
        <Flower x={64} y={60} r={10} />
        <Flower x={30} y={74} r={6} />
        <Flower x={74} y={22} r={5} />
      </svg>
    </>
  );
}

/** Deco: vějíř (paprsky v půlkruhu) nad jmény. */
export function DecoCrest() {
  const rays = Array.from({ length: 9 }, (_, i) => (i * 180) / 8);
  return (
    <svg {...common} viewBox="0 0 120 64" className="site-crest">
      <path
        className="site-divider-line"
        d="M10 60 A50 50 0 0 1 110 60 M26 60 A34 34 0 0 1 94 60"
        fill="none"
      />
      {rays.map((angle) => {
        const rad = (angle * Math.PI) / 180;
        return (
          <line
            key={angle}
            className="site-divider-line"
            x1={60}
            y1={60}
            x2={60 - Math.cos(rad) * 34}
            y2={60 - Math.sin(rad) * 34}
          />
        );
      })}
      <path className="site-divider-line" d="M0 62 H120" fill="none" />
    </svg>
  );
}

/** Deco: stupňovitá linka se středovým kosočtvercem. */
export function DecoDivider() {
  return (
    <svg {...common} viewBox="0 0 200 20" className="site-divider">
      <path
        className="site-divider-line"
        d="M0 10 H70 L76 4 H84 M0 13 H66 M116 13 H200 M200 10 H130 L124 4 H116"
        fill="none"
      />
      <path className="site-divider-gem" d="M100 1 L109 10 L100 19 L91 10 Z" />
    </svg>
  );
}
