/**
 * Statická mapa místa konání (Web Mercator, dlaždice OpenStreetMap 256 px). Čistý modul bez
 * závislostí: stejný výpočet běží při vykreslení na serveru i v živém náhledu průvodce v prohlížeči.
 * Dlaždice se vždy načítají z vlastního původu (`/api/map-tile/…`), prohlížeč hosta nekontaktuje
 * nikoho dalšího (docs/security-privacy.md).
 */

export const TILE = 256;
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 16;
/** Přiblížení pro jediné místo: ulice a okolí budovy. */
export const SINGLE_ZOOM = 15;
/** Plátno s dlaždicemi: pokryje i široký monitor, zbytek ořízne `overflow: hidden`. */
export const CANVAS = { width: 2560, height: 448 } as const;
/**
 * Bezpečný výřez kolem středu pro hroty špendlíků: na telefonu (320 px, mapa 256 px vysoká) se vejdou
 * i popisky nad špendlíky (asi 70 px nad hrotem).
 */
const FIT = { width: 220, height: 90 } as const;
/** Mez zeměpisné šířky Web Mercatoru. */
const MAX_LAT = 85.05112878;

export interface MapPoint {
  lat: number;
  lng: number;
  label: string;
}

export interface MapView {
  zoom: number;
  width: number;
  height: number;
  /** Dlaždice s polohou levého horního rohu na plátně. */
  tiles: { x: number; y: number; left: number; top: number }[];
  /** Špendlíky s polohou hrotu na plátně. */
  pins: { left: number; top: number; label: string }[];
}

/** Světové pixelové souřadnice bodu v daném přiblížení. */
export function project(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const size = TILE * 2 ** zoom;
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

/** Body se shodnou polohou (obřad a hostina na jednom místě) jsou jeden špendlík se spojeným popiskem. */
function mergePoints(points: readonly MapPoint[]): MapPoint[] {
  const merged = new Map<string, MapPoint>();
  for (const point of points) {
    const key = `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
    const existing = merged.get(key);
    if (!existing) merged.set(key, { ...point });
    else if (!existing.label.split(" · ").includes(point.label)) {
      existing.label = `${existing.label} · ${point.label}`;
    }
  }
  return [...merged.values()];
}

function fitZoom(points: readonly MapPoint[]): number {
  if (points.length === 1) return SINGLE_ZOOM;
  for (let zoom = MAX_ZOOM; zoom > MIN_ZOOM; zoom--) {
    const projected = points.map((p) => project(p.lat, p.lng, zoom));
    const xs = projected.map((p) => p.x);
    const ys = projected.map((p) => p.y);
    if (
      Math.max(...xs) - Math.min(...xs) <= FIT.width &&
      Math.max(...ys) - Math.min(...ys) <= FIT.height
    ) {
      return zoom;
    }
  }
  return MIN_ZOOM;
}

/**
 * Výřez mapy se všemi body uprostřed. Bez bodů `null` (mapa se nevykreslí).
 * ponytail: bez přechodu přes 180. poledník, svatby na opačných stranách datové hranice neřešíme.
 */
export function mapView(input: readonly MapPoint[]): MapView | null {
  const points = mergePoints(input);
  if (points.length === 0) return null;
  const zoom = fitZoom(points);
  const projected = points.map((p) => ({ ...project(p.lat, p.lng, zoom), label: p.label }));
  const xs = projected.map((p) => p.x);
  const ys = projected.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const { width, height } = CANVAS;
  // Jedno zaokrouhlení počátku: dlaždice pak navazují bez mezer.
  const left0 = Math.round(cx - width / 2);
  const top0 = Math.round(cy - height / 2);
  const n = 2 ** zoom;

  const tiles: MapView["tiles"] = [];
  for (let ty = Math.floor(top0 / TILE); ty <= Math.floor((top0 + height - 1) / TILE); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(left0 / TILE); tx <= Math.floor((left0 + width - 1) / TILE); tx++) {
      tiles.push({
        x: ((tx % n) + n) % n,
        y: ty,
        left: tx * TILE - left0,
        top: ty * TILE - top0,
      });
    }
  }
  const pins = projected.map((p) => ({
    left: Math.round(p.x - left0),
    top: Math.round(p.y - top0),
    label: p.label,
  }));
  return { zoom, width, height, tiles, pins };
}

export function tileSrc(zoom: number, x: number, y: number): string {
  return `/api/map-tile/${zoom}/${x}/${y}`;
}

/** Odkaz na místo v Google Maps (jen odkaz, nic se nevkládá). */
export function googleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat}%2C${lng}`;
}

/** Odkaz na místo v Mapy.cz (URL API `showmap`, střed je `lng,lat`). */
export function mapyCzUrl(lat: number, lng: number): string {
  return `https://mapy.cz/fnc/v1/showmap?mapset=basic&center=${lng}%2C${lat}&zoom=17&marker=true`;
}
