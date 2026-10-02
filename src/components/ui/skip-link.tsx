import { cn } from "@/lib/utils";

export interface SkipLinkProps {
  /** Text odkazu v jazyce stránky (např. `t("common.skipToContent")`). */
  children: string;
  /** Kotva cílového prvku; ten má `id` a `tabIndex={-1}`. */
  target?: string;
  className?: string;
}

/** Odkaz „Přeskočit na obsah“ (WCAG 2.4.1): první prvek stránky, viditelný při zaměření. */
export function SkipLink({ children, target = "#obsah", className }: SkipLinkProps) {
  return (
    <a
      href={target}
      className={cn(
        "sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50",
        "focus:rounded-button focus:bg-ink focus:text-parchment focus:px-5 focus:py-3 focus:font-medium",
        "focus:outline-pine",
        className,
      )}
    >
      {children}
    </a>
  );
}
