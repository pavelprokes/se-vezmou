import type { Locale } from "@/i18n/config";
import type { Translator } from "@/i18n/translator";
import type { LockedGate } from "@/site/content";
import { getPalette } from "@/site/themes/palettes";
import { paletteStyle } from "./palette-style";
import { PinGate } from "./pin-gate";
import { pinGateLabels } from "./pin-labels";
import { SiteLanguageSwitch } from "./site-language-switch";
import "./site.css";

/**
 * Zamčený web páru (heslo na celý web): jen jména, přepínač jazyka a PIN hostů. Obsah webu sem databáze
 * vůbec nevydala; po správném PINu se stránka překreslí s celým webem. Host s osobním odkazem projde bez PINu.
 */
export function LockedSite({
  gate,
  locale,
  localeHrefs,
  t,
}: {
  gate: LockedGate;
  locale: Locale;
  localeHrefs: Record<Locale, string>;
  t: Translator<"rsvp" | "site" | "common">;
}) {
  return (
    <div
      className="site-root"
      data-template={gate.template}
      data-palette={getPalette(gate.template, gate.palette).key}
      style={paletteStyle(gate)}
    >
      <header className="site-header">
        <div className="site-wrap site-header-inner">
          <SiteLanguageSwitch locales={gate.locales} current={locale} hrefs={localeHrefs} t={t} />
        </div>
      </header>
      <main id="obsah" tabIndex={-1} className="site-main">
        <section className="site-section" data-tone="bg">
          <div className="site-wrap">
            <h1>{t("site.title", { a: gate.partners.a, b: gate.partners.b })}</h1>
            <PinGate
              labels={pinGateLabels(t, "site")}
              locale={locale}
              unlockKey="site"
              headingLevel={2}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
