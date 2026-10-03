/**
 * Dekorativní inline SVG šablon. Vždy `aria-hidden`, nikdy nenese sdělení ani text; barvy jen
 * z dekorativních rolí palety (`ornament`, `decor`, `decor2`), které test kontrastu označuje
 * jako „jen dekor“. Pozicují se pod textem (`z-index` 0) a nereagují na ukazatel.
 */

const common = { "aria-hidden": true, focusable: false } as const;

function Leaf({ className, transform }: { className: string; transform: string }) {
  return (
    <path
      className={className}
      transform={transform}
      d="M0 0 C 26 -34 74 -34 100 0 C 74 34 26 34 0 0 Z"
    />
  );
}

/** Eukalyptové větvičky v rozích hrdinského bloku (jen Eukalyptus). */
export function EucalyptusLeaves() {
  return (
    <>
      <svg {...common} viewBox="0 0 260 320" className="site-leaves site-leaves-a">
        <path className="site-leaf-stem" d="M20 310 C 60 220 90 140 130 20" fill="none" />
        <Leaf className="site-leaf-1" transform="translate(52 250) rotate(-70) scale(.9)" />
        <Leaf className="site-leaf-2" transform="translate(74 200) rotate(-110) scale(.8)" />
        <Leaf className="site-leaf-1" transform="translate(94 150) rotate(-65) scale(.75)" />
        <Leaf className="site-leaf-3" transform="translate(112 100) rotate(-105) scale(.65)" />
        <Leaf className="site-leaf-2" transform="translate(126 55) rotate(-70) scale(.55)" />
      </svg>
      <svg {...common} viewBox="0 0 260 320" className="site-leaves site-leaves-b">
        <path className="site-leaf-stem" d="M240 310 C 200 220 170 140 130 20" fill="none" />
        <Leaf className="site-leaf-2" transform="translate(208 250) rotate(-110) scale(.9)" />
        <Leaf className="site-leaf-1" transform="translate(186 200) rotate(-70) scale(.8)" />
        <Leaf className="site-leaf-3" transform="translate(166 150) rotate(-115) scale(.75)" />
        <Leaf className="site-leaf-1" transform="translate(148 100) rotate(-75) scale(.65)" />
        <Leaf className="site-leaf-2" transform="translate(134 55) rotate(-110) scale(.55)" />
      </svg>
    </>
  );
}

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

/** Oddělovač sekcí Eukalyptus: linka se dvěma lístky. */
export function EucalyptusDivider() {
  return (
    <svg {...common} viewBox="0 0 200 24" className="site-divider">
      <path className="site-divider-line" d="M0 12 H78 M122 12 H200" fill="none" />
      <Leaf className="site-leaf-1" transform="translate(100 12) rotate(-30) scale(.22)" />
      <Leaf className="site-leaf-2" transform="translate(100 12) rotate(30) scale(.22)" />
    </svg>
  );
}
