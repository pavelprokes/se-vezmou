/**
 * Dekorativní inline SVG šablon. Vždy `aria-hidden`, nikdy nenese sdělení ani text; barvy jen
 * z dekorativních rolí palety (`ornament`, `decor`, `decor2`), které test kontrastu označuje
 * jako „jen dekor“. Pozicují se pod textem (`z-index` 0) a nereagují na ukazatel.
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
