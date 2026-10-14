import { describe, expect, it } from "vitest";
import { displayGalleryUrl, isOwnGallery, trackedGalleryUrl } from "./gallery-url";

const OWN = "https://photos.svatebni-fotograf-cechy.cz/s/abcDEF123/klara-a-matej";

describe("trackedGalleryUrl", () => {
  it("vlastní galerii doplní zdroj, médium a pevnou kampaň", () => {
    const url = new URL(trackedGalleryUrl(OWN, "qr-cedulka"));
    expect(url.pathname).toBe("/s/abcDEF123/klara-a-matej");
    expect(url.searchParams.get("utm_source")).toBe("se-vezmou");
    expect(url.searchParams.get("utm_medium")).toBe("qr-cedulka");
    expect(url.searchParams.get("utm_campaign")).toBe("galerie-svatby");
  });

  it("jména páru do kampaně nedává", () => {
    expect(trackedGalleryUrl(OWN, "web")).not.toContain("klara-a-matej&");
    expect(new URL(trackedGalleryUrl(OWN, "web")).searchParams.get("utm_campaign")).toBe(
      "galerie-svatby",
    );
  });

  it("parametry vložené párem nepřepisuje", () => {
    const url = new URL(trackedGalleryUrl(`${OWN}?utm_medium=vlastni`, "qr-oznameni"));
    expect(url.searchParams.get("utm_medium")).toBe("vlastni");
    expect(url.searchParams.get("utm_source")).toBe("se-vezmou");
  });

  it("cizí galerii nechá beze změny", () => {
    const foreign = "https://photos.app.goo.gl/AbCdEf";
    expect(trackedGalleryUrl(foreign, "qr-cedulka")).toBe(foreign);
    expect(isOwnGallery(foreign)).toBe(false);
  });

  it("podvržený hostitel (subdoména, http) se za vlastní nepovažuje", () => {
    expect(isOwnGallery("https://photos.svatebni-fotograf-cechy.cz.example.com/x")).toBe(false);
    expect(isOwnGallery("http://photos.svatebni-fotograf-cechy.cz/x")).toBe(false);
    expect(isOwnGallery("není adresa")).toBe(false);
  });
});

describe("displayGalleryUrl", () => {
  it("bez schématu, parametrů a koncového lomítka", () => {
    expect(displayGalleryUrl(`${OWN}/?utm_source=x`)).toBe(
      "photos.svatebni-fotograf-cechy.cz/s/abcDEF123/klara-a-matej",
    );
    expect(displayGalleryUrl("https://example.com/")).toBe("example.com");
  });
});
