import { cn } from "@/lib/utils";

/** Symbol značky (návrh A, `docs/brand/`): dva prsteny s vyplněným průnikem. Jen dekorace. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="14 41 132 78"
      className={cn("h-7 w-auto shrink-0", className)}
    >
      <defs>
        <clipPath id="brand-lens">
          <circle cx="102" cy="80" r="34" />
        </clipPath>
      </defs>
      <circle cx="58" cy="80" r="34" fill="#dca790" clipPath="url(#brand-lens)" />
      <g fill="none" strokeWidth="10">
        <circle cx="58" cy="80" r="34" stroke="var(--color-pine)" />
        <circle cx="102" cy="80" r="34" stroke="var(--color-cinnamon-deep)" />
      </g>
    </svg>
  );
}

/** Logo: symbol a název jako živý text (čtečky ho přečtou, písmo je DM Sans jako v návrhu). */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-sans font-extrabold tracking-tight",
        className,
      )}
    >
      <LogoMark />
      <span>
        se-vezmou<span className="text-cinnamon-deep">.cz</span>
      </span>
    </span>
  );
}
