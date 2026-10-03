import { describe, expect, it } from "vitest";
import {
  CANVAS,
  MAX_ZOOM,
  SINGLE_ZOOM,
  TILE,
  googleMapsUrl,
  mapView,
  mapyCzUrl,
  project,
  tileSrc,
} from "./view";

const KAPLE = { lat: 49.92556, lng: 14.27639, label: "Zámecká kaple" };

describe("project", () => {
  it("Web Mercator: rovník a nultý poledník jsou uprostřed světa", () => {
    expect(project(0, 0, 0)).toEqual({ x: 128, y: 128 });
    expect(project(0, 0, 1)).toEqual({ x: 256, y: 256 });
    expect(project(0, 180, 0).x).toBe(256);
  });

  it("póly se oříznou na mez Mercatoru", () => {
    expect(project(90, 0, 0).y).toBeCloseTo(0, 3);
    expect(project(-90, 0, 0).y).toBeCloseTo(256, 3);
  });
});

describe("mapView", () => {
  it("bez bodů není mapa", () => {
    expect(mapView([])).toBeNull();
  });

  it("jedno místo: pevné přiblížení a špendlík uprostřed plátna", () => {
    const view = mapView([KAPLE])!;
    expect(view.zoom).toBe(SINGLE_ZOOM);
    expect(view.pins).toHaveLength(1);
    expect(Math.abs(view.pins[0].left - CANVAS.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(view.pins[0].top - CANVAS.height / 2)).toBeLessThanOrEqual(1);
  });

  it("dlaždice pokryjí celé plátno bez mezer a v platném rozsahu", () => {
    const view = mapView([KAPLE])!;
    const n = 2 ** view.zoom;
    for (const tile of view.tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeLessThan(n);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeLessThan(n);
    }
    const lefts = [...new Set(view.tiles.map((t) => t.left))].sort((a, b) => a - b);
    const tops = [...new Set(view.tiles.map((t) => t.top))].sort((a, b) => a - b);
    expect(lefts[0]).toBeLessThanOrEqual(0);
    expect(tops[0]).toBeLessThanOrEqual(0);
    expect(lefts.at(-1)! + TILE).toBeGreaterThanOrEqual(CANVAS.width);
    expect(tops.at(-1)! + TILE).toBeGreaterThanOrEqual(CANVAS.height);
    lefts.slice(1).forEach((left, i) => expect(left - lefts[i]).toBe(TILE));
    expect(view.tiles).toHaveLength(lefts.length * tops.length);
  });

  it("stejné místo pro obřad i hostinu je jeden špendlík se spojeným popiskem", () => {
    const view = mapView([KAPLE, { ...KAPLE, label: "Zámecká zahrada" }, KAPLE])!;
    expect(view.pins).toEqual([
      expect.objectContaining({ label: "Zámecká kaple · Zámecká zahrada" }),
    ]);
    expect(view.zoom).toBe(SINGLE_ZOOM);
  });

  it("dvě blízká místa: co nejbližší pohled, oba špendlíky ve výřezu telefonu", () => {
    const view = mapView([KAPLE, { lat: 49.93, lng: 14.285, label: "Sál" }])!;
    expect(view.zoom).toBeLessThanOrEqual(MAX_ZOOM);
    expect(view.zoom).toBeGreaterThanOrEqual(13);
    const [a, b] = view.pins;
    expect(Math.abs(a.left - b.left)).toBeLessThanOrEqual(220);
    expect(Math.abs(a.top - b.top)).toBeLessThanOrEqual(90);
  });

  it("vzdálená místa (Praha a Brno) se oddálí", () => {
    const view = mapView([
      { lat: 50.0755, lng: 14.4378, label: "Praha" },
      { lat: 49.1951, lng: 16.6068, label: "Brno" },
    ])!;
    expect(view.zoom).toBeLessThanOrEqual(8);
    expect(view.pins).toHaveLength(2);
  });

  it("u pólu se řádky mimo svět vynechají", () => {
    const view = mapView([{ lat: 85, lng: 0, label: "Sever" }])!;
    expect(view.tiles.every((t) => t.y >= 0)).toBe(true);
  });
});

describe("adresy", () => {
  it("dlaždice z vlastního původu, odkazy na mapy přes https", () => {
    expect(tileSrc(15, 17700, 11100)).toBe("/api/map-tile/15/17700/11100");
    expect(googleMapsUrl(49.92556, 14.27639)).toBe(
      "https://www.google.com/maps/search/?api=1&query=49.92556%2C14.27639",
    );
    expect(mapyCzUrl(49.92556, 14.27639)).toBe(
      "https://mapy.cz/fnc/v1/showmap?mapset=basic&center=14.27639%2C49.92556&zoom=17&marker=true",
    );
  });
});
