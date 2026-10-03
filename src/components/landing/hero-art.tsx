import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";

/**
 * Ilustrace v heru: okno prohlížeče se svatebním webem páru Klára a Matěj, za ním karta
 * a potvrzení účasti. Inline SVG s `role="img"`, názvem a popisem; texty uvnitř jsou z překladů.
 * Jen plné plochy. Animace (zatržítko, plovoucí karta) jsou v `globals.css` a běží bez
 * `prefers-reduced-motion: reduce`.
 */
export async function HeroArt({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["landing"]);
  const initial = t("landing.sample.first").charAt(0);

  return (
    <svg
      role="img"
      aria-labelledby="hero-art-title"
      aria-describedby="hero-art-desc"
      viewBox="0 0 560 440"
      className="h-auto w-full"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title id="hero-art-title">{t("landing.hero.art.label")}</title>
      <desc id="hero-art-desc">{t("landing.hero.art.desc")}</desc>

      <circle cx="395" cy="215" r="160" fill="var(--color-linen)" />

      {/* Karta se zdobeným písmenem za oknem. */}
      <g className="art-card">
        <rect
          x="34"
          y="58"
          width="196"
          height="250"
          rx="14"
          fill="var(--color-cinnamon)"
          transform="rotate(-4 132 183)"
        />
        <text
          x="66"
          y="238"
          fontSize="120"
          fill="var(--color-parchment)"
          fontFamily="var(--font-serif)"
          transform="rotate(-4 132 183)"
        >
          {initial}
        </text>
      </g>

      {/* Okno prohlížeče. */}
      <rect
        x="150"
        y="96"
        width="360"
        height="262"
        rx="16"
        fill="var(--color-parchment)"
        stroke="var(--color-hairline)"
      />
      <path d="M150 112a16 16 0 0 1 16-16h328a16 16 0 0 1 16 16v22H150z" fill="var(--color-warm)" />
      <circle cx="172" cy="115" r="4" fill="var(--color-field-border)" />
      <circle cx="187" cy="115" r="4" fill="var(--color-field-border)" />
      <circle cx="202" cy="115" r="4" fill="var(--color-field-border)" />
      <rect x="236" y="104" width="236" height="22" rx="11" fill="#ffffff" />
      <text
        x="354"
        y="119"
        fontSize="11"
        textAnchor="middle"
        fill="var(--color-ink)"
        fontFamily="var(--font-sans)"
      >
        {t("landing.hero.art.address")}
      </text>

      <text
        x="330"
        y="178"
        fontSize="11"
        letterSpacing="2.4"
        textAnchor="middle"
        fill="var(--color-cinnamon-deep)"
        fontFamily="var(--font-sans)"
        fontWeight="700"
      >
        {t("landing.hero.art.invite").toUpperCase()}
      </text>
      <text
        x="330"
        y="226"
        fontSize="50"
        textAnchor="middle"
        fill="var(--color-pine)"
        fontFamily="var(--font-serif)"
      >
        {t("landing.sample.first")}
      </text>
      <text
        x="330"
        y="276"
        fontSize="50"
        textAnchor="middle"
        fill="var(--color-pine)"
        fontFamily="var(--font-serif)"
      >
        {`& ${t("landing.sample.second")}`}
      </text>
      <text
        x="330"
        y="294"
        fontSize="12"
        textAnchor="middle"
        fill="var(--color-ink)"
        fontFamily="var(--font-sans)"
      >
        {t("landing.sample.dateplace")}
      </text>
      <rect x="255" y="306" width="150" height="28" rx="8" fill="var(--color-pine)" />
      <text
        x="330"
        y="324"
        fontSize="10"
        letterSpacing="0.6"
        textAnchor="middle"
        fill="var(--color-parchment)"
        fontFamily="var(--font-sans)"
        fontWeight="700"
      >
        {t("landing.sample.rsvp").toUpperCase()}
      </text>

      {/* Potvrzení účasti od hosta. */}
      <g className="art-card">
        <rect
          x="24"
          y="338"
          width="244"
          height="64"
          rx="14"
          fill="#ffffff"
          stroke="var(--color-hairline)"
        />
        <circle cx="58" cy="370" r="16" fill="var(--color-linen)" />
        <path
          className="art-check"
          d="M50 370l6 6 11-12"
          fill="none"
          stroke="var(--color-pine)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text
          x="86"
          y="366"
          fontSize="13"
          fontWeight="700"
          fill="var(--color-ink)"
          fontFamily="var(--font-sans)"
        >
          {t("landing.hero.art.chipTitle")}
        </text>
        <text x="86" y="385" fontSize="10.5" fill="var(--color-ink)" fontFamily="var(--font-sans)">
          {t("landing.hero.art.chipText")}
        </text>
      </g>
    </svg>
  );
}
