import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { SITE_NAMESPACES } from "@/components/site/context";
import { SiteRenderer } from "@/components/site/site-renderer";
import { isLocale, localePath, locales, type Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { pick } from "@/site/i18n-text";
import { devPagesEnabled } from "@/site/dev-gate";
import { fixtures, sensitiveFixture, type FixtureKey } from "@/site/fixtures/klara-a-matej";
import { hasPalette, isTemplateKey, templates, templateKeys } from "@/site/themes/palettes";
import { phases, type Phase, type PublicContent } from "@/site/types";

export const metadata: Metadata = {
  title: "Náhled šablon",
  robots: { index: false, follow: false },
};

type Search = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

interface State {
  fixture: FixtureKey;
  template: PublicContent["template"];
  palette: string;
  phase: Phase;
  unlocked: boolean;
  /** Fotka v úvodu (první fotografie fixtury s popiskem). */
  heroPhoto: boolean;
}

function readState(search: Search): State {
  const fixtureParam = first(search.fixture);
  const fixture: FixtureKey =
    fixtureParam && fixtureParam in fixtures ? (fixtureParam as FixtureKey) : "eukalyptus";
  const base = fixtures[fixture];
  const templateParam = first(search.template);
  const template = templateParam && isTemplateKey(templateParam) ? templateParam : base.template;
  const paletteParam = first(search.palette);
  const palette =
    paletteParam && hasPalette(template, paletteParam)
      ? paletteParam
      : template === base.template
        ? base.palette
        : templates[template].defaultPalette;
  const phaseParam = first(search.phase);
  const phase = (phases as readonly string[]).includes(phaseParam ?? "")
    ? (phaseParam as Phase)
    : base.phase;
  return {
    fixture,
    template,
    palette,
    phase,
    unlocked: first(search.unlocked) === "1",
    heroPhoto: first(search.heroPhoto) === "1",
  };
}

function query(state: State, change: Partial<State>): string {
  const next = { ...state, ...change };
  // Při změně šablony se vrací její výchozí paleta, ne paleta jiné šablony.
  if (change.template && change.palette === undefined) {
    next.palette = templates[change.template].defaultPalette;
  }
  const params = new URLSearchParams({
    fixture: next.fixture,
    template: next.template,
    palette: next.palette,
    phase: next.phase,
  });
  if (next.unlocked) params.set("unlocked", "1");
  if (next.heroPhoto) params.set("heroPhoto", "1");
  return `?${params.toString()}`;
}

function Group({
  label,
  items,
}: {
  label: string;
  items: { text: string; href: string; current: boolean }[];
}) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="font-semibold">{label}:</span>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              aria-current={item.current ? "true" : undefined}
              className={
                item.current
                  ? "min-h-target bg-linen inline-flex items-center rounded px-3 font-semibold underline underline-offset-4"
                  : "min-h-target text-pine hover:bg-linen inline-flex items-center rounded px-3 underline underline-offset-4"
              }
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * Vývojový náhled webu páru: přepínání šablony, palety, fáze a odemčení citlivých bloků na
 * ukázkové fixtuře. Mimo produkci (viz `devPagesEnabled`); čte prostředí za běhu (`connection()`).
 * Slouží vizuální kontrole a automatickým testům přístupnosti všech šablon.
 */
export default async function SitePreview({
  params,
  searchParams,
}: PageProps<"/h/marketing/[locale]/site-preview">) {
  await connection();
  if (!devPagesEnabled()) notFound();

  const { locale: localeParam } = await params;
  if (!isLocale(localeParam)) notFound();
  const locale: Locale = localeParam;
  const t = await getTranslator(locale, SITE_NAMESPACES);
  const state = readState(await searchParams);

  const fixture = fixtures[state.fixture];
  const photoId = fixture.media.find((m) => !m.decorative)?.id ?? null;
  const content: PublicContent = {
    ...fixture,
    template: state.template,
    palette: state.palette,
    phase: state.phase,
    blocks: fixture.blocks.map((block) =>
      block.type === "hero" && state.heroPhoto
        ? { ...block, data: { ...block.data, photoMediaId: photoId } }
        : block,
    ),
  };
  const search = query(state, {});
  const base = localePath("/site-preview", locale);
  const localeHrefs = Object.fromEntries(
    locales.map((l) => [l, `${localePath("/site-preview", l)}${search}`]),
  ) as Record<Locale, string>;

  return (
    <>
      <nav aria-label={t("site.preview.nav")} className="bg-parchment px-4 py-3 text-base sm:px-8">
        <p className="font-serif text-xl font-medium">{t("site.preview.title")}</p>
        <ul className="mt-2 flex flex-col gap-1">
          <Group
            label={t("site.preview.fixture")}
            items={(Object.keys(fixtures) as FixtureKey[]).map((key) => ({
              text: key,
              href: `${base}${query(state, { fixture: key })}`,
              current: key === state.fixture,
            }))}
          />
          <Group
            label={t("site.preview.template")}
            items={templateKeys.map((key) => ({
              text: pick(templates[key].name, locale),
              href: `${base}${query(state, { template: key })}`,
              current: key === state.template,
            }))}
          />
          <Group
            label={t("site.preview.palette")}
            items={templates[state.template].palettes.map((palette) => ({
              text: pick(palette.name, locale),
              href: `${base}${query(state, { palette: palette.key })}`,
              current: palette.key === state.palette,
            }))}
          />
          <Group
            label={t("site.preview.phase")}
            items={phases.map((phase) => ({
              text: t(`site.phase.${phase}`),
              href: `${base}${query(state, { phase })}`,
              current: phase === state.phase,
            }))}
          />
          <Group
            label={t("site.preview.unlocked")}
            items={[
              {
                text: t("site.preview.unlocked.off"),
                href: `${base}${query(state, { unlocked: false })}`,
                current: !state.unlocked,
              },
              {
                text: t("site.preview.unlocked.on"),
                href: `${base}${query(state, { unlocked: true })}`,
                current: state.unlocked,
              },
            ]}
          />
          <Group
            label={t("site.preview.heroPhoto")}
            items={[
              {
                text: t("site.preview.heroPhoto.off"),
                href: `${base}${query(state, { heroPhoto: false })}`,
                current: !state.heroPhoto,
              },
              {
                text: t("site.preview.heroPhoto.on"),
                href: `${base}${query(state, { heroPhoto: true })}`,
                current: state.heroPhoto,
              },
            ]}
          />
        </ul>
      </nav>
      <SiteRenderer
        content={content}
        t={t}
        localeHrefs={localeHrefs}
        now={new Date("2026-10-02T10:00:00+02:00")}
        sensitiveUnlocked={state.unlocked}
        sensitive={sensitiveFixture}
      />
    </>
  );
}
