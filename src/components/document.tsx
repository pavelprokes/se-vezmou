import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { DM_Sans, Newsreader } from "next/font/google";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import "@/app/globals.css";

// Písma se stáhnou při sestavení a hostují se spolu s aplikací; prohlížeč nevolá Google.
// `latin-ext` je nutné pro českou diakritiku.
const dmSans = DM_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-dm-sans",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin", "latin-ext"],
  // Kurzíva pro nadpisy šablony Eukalyptus (jinak by ji prohlížeč dopočítal nakloněním).
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
});

export interface DocumentProps {
  /** Hodnota atributu `lang` (WCAG 3.1.1). */
  lang: string;
  children: ReactNode;
  /** Měření návštěvnosti a výkonu. Weby párů ho nemají (soukromí hostů). */
  measure?: boolean;
  /** Další třídy `<html>`, např. proměnná písma, které načítá jen jeden hostitel. */
  className?: string;
}

/**
 * Obal `<html>` a `<body>` pro kořenové layouty jednotlivých hostitelů
 * (aplikace nemá jeden společný kořenový layout, protože `lang` závisí na jazyce).
 */
export function Document({ lang, children, measure = true, className }: DocumentProps) {
  return (
    <html
      lang={lang}
      className={cn(dmSans.variable, newsreader.variable, "h-full antialiased", className)}
    >
      <body className="flex min-h-full flex-col">
        {children}
        {measure ? (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        ) : null}
      </body>
    </html>
  );
}
