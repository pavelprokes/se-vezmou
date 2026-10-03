import type { Translator } from "@/i18n/translator";

/**
 * Živé ukázky čtyř šablon (Editorial, Eukalyptus, Chateau, Modern) s ukázkovými jmény Klára a Matěj.
 * Jsou to jednoduché HTML a SVG komponenty, ne obrázky: text zůstane text a jde zvětšit.
 * Každá ukázka je pro čtečky jeden obrázek s popisem; vnitřek je jen dekorace.
 *
 * Barvy tmavého a pískového podkladu patří paletám šablon (ilustrace), ne tokenům značky.
 * Kontrast textu v ukázkách je i tak nad 4,5 : 1.
 */

const frame =
  "relative min-h-80 w-full overflow-hidden rounded-2xl border border-hairline p-4 sm:aspect-[4/5] sm:min-h-0 sm:p-6";

function Sample({ t, name, className, children }: PreviewProps & { className: string }) {
  return (
    <div
      role="img"
      aria-label={t("landing.templates.preview", { name })}
      className={`${frame} ${className}`}
    >
      {children}
    </div>
  );
}

interface PreviewProps {
  t: Translator<"landing">;
  name: string;
  children?: React.ReactNode;
}

export function EditorialPreview({ t }: { t: Translator<"landing"> }) {
  return (
    <Sample t={t} name={t("landing.templates.editorial.name")} className="bg-parchment">
      <span className="bg-ink block h-0.5 w-7" />
      <p className="text-ink mt-5 font-serif text-2xl leading-[1.05] sm:text-3xl">
        {t("landing.sample.first")}
        <br />
        &amp; {t("landing.sample.second")}
      </p>
      <p className="text-muted mt-3 text-[11px]">{t("landing.sample.dateplace")}</p>
      <span className="bg-linen mt-4 block h-14 rounded-md sm:mt-5 sm:h-20" />
      <span className="border-ink text-ink mt-5 inline-block rounded-full border px-4 py-1.5 text-[11px] font-medium">
        {t("landing.sample.rsvp")}
      </span>
    </Sample>
  );
}

export function EucalyptusPreview({ t }: { t: Translator<"landing"> }) {
  return (
    <Sample t={t} name={t("landing.templates.eucalyptus.name")} className="bg-[#e4eee9]">
      <svg
        aria-hidden="true"
        viewBox="0 0 80 200"
        className="absolute top-0 right-0 h-3/5 w-1/3"
        focusable="false"
      >
        <path d="M58 0v190" stroke="#365c4e" strokeWidth="2" fill="none" />
        {[
          [58, 22, 17, "#9db8aa"],
          [36, 52, 14, "#b6cbbf"],
          [66, 84, 19, "#9db8aa"],
          [40, 116, 15, "#b6cbbf"],
          [64, 146, 17, "#9db8aa"],
        ].map(([cx, cy, r, fill]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill={String(fill)} />
        ))}
      </svg>
      <div className="relative flex h-full flex-col items-center justify-center text-center">
        <p className="text-pine font-serif text-2xl leading-[1.05] italic sm:text-3xl">
          {t("landing.sample.first")}
          <br />
          &amp; {t("landing.sample.second")}
        </p>
        <p className="text-ink mt-3 text-[11px]">{t("landing.sample.dateplace")}</p>
        <span className="bg-pine text-parchment mt-5 inline-block rounded-md px-4 py-2 text-[11px] font-medium">
          {t("landing.sample.rsvp")}
        </span>
      </div>
    </Sample>
  );
}

export function ChateauPreview({ t }: { t: Translator<"landing"> }) {
  return (
    <Sample t={t} name={t("landing.templates.chateau.name")} className="bg-[#e9dfcc]">
      <span
        aria-hidden="true"
        className="absolute inset-3 rounded-lg border border-[#8a6f4e] sm:inset-4"
      />
      <div className="relative flex h-full flex-col items-center justify-center text-center">
        <span className="flex size-16 items-center justify-center rounded-full border border-[#8a6f4e] font-serif text-lg text-[#5b4630]">
          {t("landing.sample.monogram")}
        </span>
        <p className="mt-5 text-[11px] font-medium tracking-[0.2em] text-[#3d2f20] uppercase">
          {t("landing.sample.names")}
        </p>
        <p className="mt-2 text-[11px] text-[#3d2f20]">{t("landing.sample.dateplace")}</p>
        <span className="mt-5 inline-block rounded-full border border-[#5b4630] px-4 py-1.5 text-[11px] font-medium text-[#3d2f20]">
          {t("landing.sample.rsvp")}
        </span>
      </div>
    </Sample>
  );
}

export function ModernPreview({ t }: { t: Translator<"landing"> }) {
  return (
    <Sample t={t} name={t("landing.templates.modern.name")} className="bg-ink border-ink">
      <p className="text-parchment font-sans text-2xl leading-[1.02] font-extrabold tracking-tight uppercase sm:text-3xl">
        {t("landing.sample.first")}
        <br />+ {t("landing.sample.second")}
      </p>
      <p className="text-linen mt-3 text-[11px]">{t("landing.sample.dateplace")}</p>
      <span className="bg-cinnamon mt-4 block h-14 rounded-md sm:mt-5 sm:h-20" />
      <span className="bg-parchment text-ink mt-5 inline-block rounded-md px-4 py-2 text-[11px] font-medium">
        {t("landing.sample.rsvp")}
      </span>
    </Sample>
  );
}
