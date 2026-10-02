import { crc32 } from "node:zlib";
import sharp, { type Sharp } from "sharp";
import { describe, expect, it } from "vitest";
import { MediaError, processImage, sniffImageType, variantWidths } from "./process";

async function jpeg(width: number, height: number, extra?: (s: Sharp) => Sharp) {
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } },
  }).jpeg({ quality: 90 });
  return (extra ? extra(base) : base).toBuffer();
}

async function failure(input: Buffer, options?: Parameters<typeof processImage>[1]) {
  const error = await processImage(input, options).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(MediaError);
  return (error as MediaError).code;
}

describe("rozpoznání typu podle obsahu", () => {
  it("pozná JPEG, PNG a WebP z prvních bajtů", async () => {
    expect(sniffImageType(await jpeg(8, 8))).toBe("jpeg");
    expect(
      sniffImageType(
        await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } })
          .png()
          .toBuffer(),
      ),
    ).toBe("png");
    expect(
      sniffImageType(
        await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } })
          .webp()
          .toBuffer(),
      ),
    ).toBe("webp");
  });

  it("SVG, GIF, HTML, PDF a prázdný soubor nejsou obrázky k přijetí", () => {
    const text = (value: string) => Buffer.from(value, "utf8");
    expect(sniffImageType(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImageType(text('<?xml version="1.0"?><svg/>'))).toBeNull();
    expect(sniffImageType(text("GIF89a......"))).toBeNull();
    expect(sniffImageType(text("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImageType(text("%PDF-1.7"))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });

  it("HEIC z iPhonu se pozná kvůli srozumitelné zprávě", () => {
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypheic", "latin1"),
      Buffer.alloc(16),
    ]);
    expect(sniffImageType(heic)).toBe("heic");
    const avif = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypavif", "latin1"),
      Buffer.alloc(16),
    ]);
    expect(sniffImageType(avif)).toBeNull();
  });

  it("přípona ani deklarovaný typ nerozhodují: SVG převlečené za JPEG se odmítne", async () => {
    expect(await failure(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10"/>'))).toBe(
      "unsupported_type",
    );
    expect(await failure(Buffer.from("GIF89a\x01\x00\x01\x00"))).toBe("unsupported_type");
    expect(await failure(Buffer.alloc(0))).toBe("empty");
    expect(
      await failure(
        Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(40)]),
      ),
    ).toBe("heic");
  });
});

describe("šířky variant", () => {
  it("jen cílové šířky nepřesahující originál", () => {
    expect(variantWidths(6000)).toEqual([640, 1280, 1920]);
    expect(variantWidths(1920)).toEqual([640, 1280, 1920]);
    expect(variantWidths(1400)).toEqual([640, 1280]);
  });

  it("menší originál nese i vlastní šířku, nikdy se nezvětšuje", () => {
    expect(variantWidths(1000)).toEqual([640, 1000]);
    expect(variantWidths(300)).toEqual([300]);
    expect(variantWidths(640)).toEqual([640]);
    expect(variantWidths(700)).toEqual([640]);
    expect(variantWidths(1300)).toEqual([640, 1280]);
    expect(variantWidths(1500, [640, 1280])).toEqual([640, 1280]);
  });
});

describe("zpracování", () => {
  it("velká fotografie: 640, 1280, 1920 ve WebP i AVIF, poměr stran se zachová", async () => {
    const result = await processImage(await jpeg(3000, 2000));
    expect(result.sourceType).toBe("jpeg");
    expect(result.variants.map((v) => `${v.width}.${v.format}`).sort()).toEqual([
      "1280.avif",
      "1280.webp",
      "1920.avif",
      "1920.webp",
      "640.avif",
      "640.webp",
    ]);
    for (const variant of result.variants) {
      expect(variant.height).toBe(Math.round((variant.width * 2) / 3));
      expect(variant.bytes).toBe(variant.data.length);
      const meta = await sharp(variant.data).metadata();
      expect(meta.format).toBe(variant.format === "avif" ? "heif" : "webp");
      expect(meta.width).toBe(variant.width);
    }
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1280);
    expect(result.originalWidth).toBe(3000);
  }, 60_000);

  it("nikdy nezvětšuje: malý originál dává jen varianty do jeho šířky", async () => {
    const result = await processImage(await jpeg(1000, 500));
    expect(result.variants.map((v) => v.width).sort((a, b) => a - b)).toEqual([
      640, 640, 1000, 1000,
    ]);
    expect(Math.max(...result.variants.map((v) => v.width))).toBeLessThanOrEqual(1000);
    expect(result.width).toBe(1000);

    const tiny = await processImage(await jpeg(200, 100));
    expect(tiny.variants.map((v) => v.width)).toEqual([200, 200]);
  });

  it("PNG a WebP na vstupu, průhlednost zůstane", async () => {
    const png = await sharp({
      create: {
        width: 900,
        height: 600,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    const fromPng = await processImage(png, { formats: ["webp"] });
    expect(fromPng.sourceType).toBe("png");
    expect((await sharp(fromPng.variants[0].data).metadata()).hasAlpha).toBe(true);

    const webp = await sharp({
      create: { width: 900, height: 600, channels: 3, background: "#123456" },
    })
      .webp()
      .toBuffer();
    expect((await processImage(webp, { formats: ["webp"] })).sourceType).toBe("webp");
  });

  it("karta externí galerie: jen zadané šířky", async () => {
    const result = await processImage(await jpeg(3000, 1500), { widths: [640, 1280] });
    expect(result.variants.map((v) => v.width).sort((a, b) => a - b)).toEqual([
      640, 640, 1280, 1280,
    ]);
  }, 30_000);
});

describe("odstranění metadat (EXIF, GPS, ICC)", () => {
  const withGps = (s: Sharp) =>
    s.withExif({
      IFD0: { Copyright: "Tajný majitel foťáku", Make: "TajnaZnacka", Software: "TajnySoftware" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "50/1 5/1 1234/100",
        GPSLongitudeRef: "E",
        GPSLongitude: "14/1 25/1 4321/100",
      },
    });

  it("vstup skutečně nese EXIF i GPS (ověření testu)", async () => {
    const input = await jpeg(1600, 900, withGps);
    const meta = await sharp(input).metadata();
    expect(meta.exif).toBeDefined();
    expect(input.includes(Buffer.from("TajnaZnacka"))).toBe(true);
    expect(input.includes(Buffer.from("Exif"))).toBe(true);
  });

  it("žádná varianta nenese EXIF, GPS, XMP ani ICC profil", async () => {
    const input = await jpeg(1600, 900, withGps);
    const result = await processImage(input);
    expect(result.variants.length).toBeGreaterThan(0);
    for (const { data, format } of result.variants) {
      const meta = await sharp(data).metadata();
      expect(meta.exif, `${format}: exif`).toBeUndefined();
      expect(meta.xmp, `${format}: xmp`).toBeUndefined();
      expect(meta.icc, `${format}: icc`).toBeUndefined();
      expect(meta.orientation, `${format}: orientation`).toBeUndefined();
      for (const needle of [
        "Exif",
        "TajnaZnacka",
        "TajnySoftware",
        "Tajný majitel",
        "GPS",
        "http://ns.adobe.com/xap",
      ]) {
        expect(data.includes(Buffer.from(needle)), `${format}: ${needle}`).toBe(false);
      }
    }
  }, 60_000);

  it("otočí podle EXIF orientace a orientaci neponechá", async () => {
    // 1200 x 600 s orientací 6 (otočit o 90°) je portrét 600 x 1200
    const input = await jpeg(1200, 600, (s) => s.withMetadata({ orientation: 6 }));
    expect((await sharp(input).metadata()).orientation).toBe(6);
    const result = await processImage(input, { formats: ["webp"] });
    expect(result.originalWidth).toBe(600);
    expect(result.originalHeight).toBe(1200);
    const largest = result.variants.reduce((a, b) => (b.width > a.width ? b : a));
    const meta = await sharp(largest.data).metadata();
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(1200);
    expect(meta.orientation).toBeUndefined();
  });

  it("barevný profil se převede do sRGB a profil se neponechá", async () => {
    const input = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 200, b: 30 } },
    })
      .toColourspace("srgb")
      .withIccProfile("p3")
      .jpeg()
      .toBuffer();
    expect((await sharp(input).metadata()).icc).toBeDefined();
    const result = await processImage(input, { formats: ["webp"] });
    const meta = await sharp(result.variants[0].data).metadata();
    expect(meta.icc).toBeUndefined();
    expect(meta.space).toBe("srgb");
    // Display P3 zelená je v sRGB sytější: po převodu se hodnota kanálu změní (profil se promítl do pixelů)
    const [r, g] = (await sharp(result.variants[0].data).raw().toBuffer()).subarray(0, 3);
    expect(g).toBeGreaterThan(150);
    expect(r).toBeLessThan(60);
  });
});

describe("limity a poškozené soubory", () => {
  it("příliš mnoho pixelů se odmítne podle zadaného limitu", async () => {
    expect(await failure(await jpeg(2000, 1000), { maxPixels: 1_000_000 })).toBe("too_many_pixels");
  });

  it("výchozí limit je 100 megapixelů a „bomba“ se odmítne z hlavičky bez dekódování", async () => {
    // PNG s hlavičkou 20000 x 20000 (400 MP) a téměř prázdnými daty: odmítne se, dřív než se cokoli dekóduje
    const real = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    const bomb = Buffer.from(real);
    // IHDR: 8 bajtů podpisu, 4 délka, 4 "IHDR", pak šířka a výška (po 4 bajtech), CRC za 13 bajty dat
    bomb.writeUInt32BE(20000, 16);
    bomb.writeUInt32BE(20000, 20);
    bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)) >>> 0, 29);
    const started = Date.now();
    expect(await failure(bomb)).toBe("too_many_pixels");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("useknutý a poškozený soubor je chyba, ne pád", async () => {
    const good = await jpeg(1200, 800);
    expect(await failure(good.subarray(0, Math.floor(good.length / 3)))).toBe("corrupt");
    expect(await failure(Buffer.concat([good.subarray(0, 64), Buffer.alloc(500, 7)]))).toBe(
      "corrupt",
    );
    expect(await failure(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]))).toBe("corrupt");
  });
});
