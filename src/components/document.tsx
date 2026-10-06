import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import {
  DM_Sans,
  DM_Serif_Display,
  EB_Garamond,
  Fraunces,
  Marcellus,
  Newsreader,
} from "next/font/google";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { UmamiScript } from "@/components/umami-script";
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

// Nadpisová písma šablon Statek, Vinice, Louka a Deco: bez přednačtení, prohlížeč je stáhne, jen
// když je stránka opravdu použije (web páru v té šabloně, náhled šablony).
const fraunces = Fraunces({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  variable: "--font-statek",
  display: "swap",
  preload: false,
});
const ebGaramond = EB_Garamond({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  variable: "--font-vinice",
  display: "swap",
  preload: false,
});
const dmSerifDisplay = DM_Serif_Display({
  subsets: ["latin", "latin-ext"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-louka",
  display: "swap",
  preload: false,
});
const marcellus = Marcellus({
  subsets: ["latin", "latin-ext"],
  weight: "400",
  variable: "--font-deco",
  display: "swap",
  preload: false,
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
      className={cn(
        dmSans.variable,
        newsreader.variable,
        fraunces.variable,
        ebGaramond.variable,
        dmSerifDisplay.variable,
        marcellus.variable,
        "h-full antialiased",
        className,
      )}
    >
      <body className="flex min-h-full flex-col">
        {children}
        {measure ? (
          <>
            <Analytics />
            <SpeedInsights />
            <UmamiScript />
          </>
        ) : null}
      </body>
    </html>
  );
}
