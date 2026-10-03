import { luminance, parseColor } from "@/design/contrast";
import { getPalette } from "@/site/themes/palettes";
import { mapView, tileSrc, type MapPoint } from "@/site/map/view";
import type { SiteCtx } from "./context";

/** Pod touto světlostí pozadí je paleta tmavá a mapa se vykreslí v tmavé variantě. */
const DARK_BG = 0.2;

/**
 * Statická mapa místa konání přes celou šířku sekce: dlaždice OpenStreetMap z vlastního původu
 * (`/api/map-tile`), špendlíky a ladění barev podle šablony jen v CSS. Bez JavaScriptu a bez vložení
 * třetí strany; adresa a odkazy na mapy jsou v kartách míst, mapa je doplněk (proto obrázek s popisem).
 */
export function VenueMap({ points, ctx }: { points: MapPoint[]; ctx: SiteCtx }) {
  const view = mapView(points);
  if (!view) return null;
  const { t, content } = ctx;
  const bg = getPalette(content.template, content.palette).colors.bg;
  const dark = luminance(parseColor(bg)) < DARK_BG;
  const places = view.pins.map((pin) => pin.label).join(", ");

  return (
    <figure className="site-map" data-dark={dark ? "true" : undefined}>
      <div className="site-map-view" role="img" aria-label={t("site.venue.mapLabel", { places })}>
        <div
          className="site-map-canvas"
          style={{
            width: view.width,
            height: view.height,
            marginLeft: -view.width / 2,
            marginTop: -view.height / 2,
          }}
        >
          {view.tiles.map((tile) => (
            // eslint-disable-next-line @next/next/no-img-element -- dlaždice z vlastní proxy, optimalizace Next se nepoužívá
            <img
              key={`${tile.left},${tile.top}`}
              src={tileSrc(view.zoom, tile.x, tile.y)}
              alt=""
              width={256}
              height={256}
              loading="lazy"
              decoding="async"
              draggable={false}
              style={{ left: tile.left, top: tile.top }}
            />
          ))}
          {view.pins.map((pin, index) => (
            <span
              key={index}
              className="site-map-pin"
              data-label={pin.label}
              style={{ left: pin.left, top: pin.top }}
            />
          ))}
        </div>
      </div>
      <figcaption className="site-map-credit">
        <a
          href="https://www.openstreetmap.org/copyright"
          rel="noopener noreferrer"
          className="site-map-credit-link"
        >
          {t("site.venue.osmCredit")}
        </a>
      </figcaption>
    </figure>
  );
}
