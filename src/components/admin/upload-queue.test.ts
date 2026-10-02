import { describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@/lib/media/types";
import {
  PutError,
  UploadQueue,
  declaredMime,
  downscale,
  precheck,
  type QueueDeps,
  type QueueEntry,
} from "./upload-queue";

/**
 * Fronta nahrávání v prohlížeči (M7c): po jednom souboru, kontrola typu, opakování s čekáním, obnovení adresy,
 * srozumitelné chyby a záloha na původní soubor při selhání zmenšení.
 */

const ITEM: MediaItem = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "photo",
  status: "ready",
  failureCode: null,
  width: 1920,
  height: 1280,
  bytes: 100,
  alt: null,
  decorative: false,
  widths: [640, 1280, 1920],
};

const file = (name: string, type: string, size = 100) =>
  new File([new Uint8Array(size)], name, { type });

function setup(overrides: Partial<QueueDeps> = {}, slots = 12) {
  const log: string[] = [];
  const entries: QueueEntry[][] = [];
  const done: { item: MediaItem; entry: QueueEntry }[] = [];
  const announced: QueueEntry[] = [];
  let counter = 0;
  const deps: QueueDeps = {
    actions: {
      requestUpload: vi.fn(async ({ mime, bytes }) => {
        log.push(`request:${mime}:${bytes}`);
        return {
          status: "ok" as const,
          id: `id${++counter}`,
          url: `https://r2.example/put${counter}`,
          headers: { "Content-Type": mime },
          expiresInSeconds: 600,
        };
      }),
      renewUpload: vi.fn(async ({ id }) => {
        log.push(`renew:${id}`);
        return {
          status: "ok" as const,
          id,
          url: `https://r2.example/renewed-${id}`,
          headers: {},
          expiresInSeconds: 600,
        };
      }),
      finishUpload: vi.fn(async (id) => {
        log.push(`finish:${id}`);
        return { status: "ok" as const, item: { ...ITEM, id } };
      }),
    },
    put: vi.fn(async (target, blob, onProgress) => {
      log.push(`put:${target.url}:${blob.size}`);
      onProgress(40);
      onProgress(80);
    }),
    prepare: async (f) => f,
    sleep: vi.fn(async () => undefined),
    slotsLeft: () => slots,
    onChange: (e) => entries.push([...e]),
    onDone: (item, entry) => done.push({ item, entry }),
    announce: (entry) => announced.push(entry),
    ...overrides,
  };
  const queue = new UploadQueue(deps);
  const settle = async () => {
    for (let i = 0; i < 200; i++) {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      const snapshot = queue.snapshot();
      if (
        snapshot.length > 0 &&
        snapshot.every((e) => e.status === "done" || e.status === "error")
      ) {
        return;
      }
    }
  };
  return { queue, deps, log, entries, done, announced, settle };
}

describe("precheck a typ souboru", () => {
  it("přijme JPEG, PNG a WebP podle typu i podle přípony", () => {
    expect(precheck({ name: "a.jpg", type: "image/jpeg" })).toBeNull();
    expect(precheck({ name: "a.png", type: "image/png" })).toBeNull();
    expect(precheck({ name: "a.webp", type: "image/webp" })).toBeNull();
    expect(precheck({ name: "IMG_1.JPG", type: "" })).toBeNull();
    expect(precheck({ name: "a.jpeg", type: "" })).toBeNull();
    expect(declaredMime({ name: "a.JPEG", type: "" })).toBe("image/jpeg");
  });

  it("HEIC se odmítne srozumitelně, SVG a ostatní jako nepodporovaný typ", () => {
    expect(precheck({ name: "a.heic", type: "image/heic" })).toBe("heic");
    expect(precheck({ name: "a.HEIC", type: "" })).toBe("heic");
    expect(precheck({ name: "a.heif", type: "image/heif" })).toBe("heic");
    expect(precheck({ name: "a.svg", type: "image/svg+xml" })).toBe("type");
    expect(precheck({ name: "a.gif", type: "image/gif" })).toBe("type");
    expect(precheck({ name: "a.pdf", type: "application/pdf" })).toBe("type");
    expect(precheck({ name: "bezpripony", type: "" })).toBe("type");
  });
});

describe("UploadQueue", () => {
  it("jeden soubor: žádost, nahrání s průběhem, dokončení; hotovou fotografii předá", async () => {
    const t = setup();
    t.queue.add([file("svatba.jpg", "image/jpeg", 1234)]);
    await t.settle();
    expect(t.log).toEqual([
      "request:image/jpeg:1234",
      "put:https://r2.example/put1:1234",
      "finish:id1",
    ]);
    const states = t.entries.map((e) => e[0]?.status);
    expect(states).toEqual(
      expect.arrayContaining(["queued", "preparing", "uploading", "processing", "done"]),
    );
    expect(t.entries.flat().some((e) => e.status === "uploading" && e.progress === 80)).toBe(true);
    expect(t.done).toHaveLength(1);
    expect(t.done[0].item.id).toBe("id1");
    expect(t.queue.snapshot()[0]).toMatchObject({ status: "done", progress: 100, mediaId: "id1" });
    expect(t.announced.map((e) => e.status)).toEqual(["done"]);
  });

  it("soubory se zpracovávají po jednom, v pořadí", async () => {
    const t = setup();
    t.queue.add([
      file("a.jpg", "image/jpeg"),
      file("b.png", "image/png"),
      file("c.webp", "image/webp"),
    ]);
    await t.settle();
    expect(t.log.filter((l) => l.startsWith("finish:"))).toEqual([
      "finish:id1",
      "finish:id2",
      "finish:id3",
    ]);
    // žádost o další soubor přijde až po dokončení předchozího
    expect(t.log.map((l) => l.split(":")[0])).toEqual([
      "request",
      "put",
      "finish",
      "request",
      "put",
      "finish",
      "request",
      "put",
      "finish",
    ]);
  });

  it("nepodporovaný typ a HEIC se odmítnou bez jediného volání serveru, ostatní soubory pokračují", async () => {
    const t = setup();
    t.queue.add([
      file("a.heic", "image/heic"),
      file("b.svg", "image/svg+xml"),
      file("c.jpg", "image/jpeg"),
    ]);
    await t.settle();
    const [heic, svg, ok] = t.queue.snapshot();
    expect(heic).toMatchObject({ status: "error", error: "heic" });
    expect(svg).toMatchObject({ status: "error", error: "type" });
    expect(ok.status).toBe("done");
    expect(t.log.filter((l) => l.startsWith("request:"))).toHaveLength(1);
    expect(t.announced.map((e) => e.error).filter(Boolean)).toEqual(["heic", "type"]);
  });

  it("co se nevejde do limitu, skončí chybou kvóty (ještě před nahráním)", async () => {
    const t = setup({}, 2);
    t.queue.add([
      file("1.jpg", "image/jpeg"),
      file("2.jpg", "image/jpeg"),
      file("3.jpg", "image/jpeg"),
    ]);
    await t.settle();
    expect(t.queue.snapshot().map((e) => e.status)).toEqual(["done", "done", "error"]);
    expect(t.queue.snapshot()[2].error).toBe("quota");
    expect(t.log.filter((l) => l.startsWith("request:"))).toHaveLength(2);
  });

  it("soubor větší než 40 MB po případném zmenšení se odmítne před žádostí", async () => {
    const t = setup();
    t.queue.add([file("obri.jpg", "image/jpeg", 40 * 1024 * 1024 + 1)]);
    await t.settle();
    expect(t.queue.snapshot()[0]).toMatchObject({ status: "error", error: "too_large" });
    expect(t.log).toEqual([]);
  });

  it("zmenšení před nahráním: nahraje se menší soubor; když selže, původní", async () => {
    const small = new Blob([new Uint8Array(50)], { type: "image/jpeg" });
    const t = setup({ prepare: async () => small });
    t.queue.add([file("a.jpg", "image/jpeg", 5000)]);
    await t.settle();
    expect(t.log[0]).toBe("request:image/jpeg:50");

    const failing = setup({
      prepare: async () => {
        throw new Error("nedostatek paměti");
      },
    });
    failing.queue.add([file("a.jpg", "image/jpeg", 5000)]);
    await failing.settle();
    expect(failing.log[0]).toBe("request:image/jpeg:5000");
    expect(failing.queue.snapshot()[0].status).toBe("done");
  });

  describe("nahrávání do úložiště: opakování", () => {
    it("výpadek sítě se zopakuje s čekáním a nakonec projde", async () => {
      let attempts = 0;
      const t = setup({
        put: vi.fn(async () => {
          if (++attempts < 3) throw new PutError(0);
        }),
      });
      t.queue.add([file("a.jpg", "image/jpeg")]);
      await t.settle();
      expect(attempts).toBe(3);
      expect(t.queue.snapshot()[0].status).toBe("done");
      expect(t.deps.sleep).toHaveBeenCalledTimes(2);
      expect(t.deps.sleep).toHaveBeenNthCalledWith(1, 800);
      expect(t.deps.sleep).toHaveBeenNthCalledWith(2, 2500);
    });

    it("po vypršení adresy (403) se pro tutéž fotografii vyžádá nová a nahraje se na ni", async () => {
      const urls: string[] = [];
      const t = setup({
        put: vi.fn(async (target) => {
          urls.push(target.url);
          if (urls.length === 1) throw new PutError(403);
        }),
      });
      t.queue.add([file("a.jpg", "image/jpeg")]);
      await t.settle();
      expect(urls).toEqual(["https://r2.example/put1", "https://r2.example/renewed-id1"]);
      expect(t.deps.actions.requestUpload).toHaveBeenCalledTimes(1);
      expect(t.queue.snapshot()[0].status).toBe("done");
    });

    it("trvalá chyba skončí chybou sítě, ruční „zkusit znovu“ obnoví adresu a nezakládá druhou fotografii", async () => {
      let failing = true;
      const t = setup({
        put: vi.fn(async () => {
          if (failing) throw new PutError(0);
        }),
      });
      t.queue.add([file("a.jpg", "image/jpeg")]);
      await t.settle();
      const [failed] = t.queue.snapshot();
      expect(failed).toMatchObject({ status: "error", error: "network", mediaId: "id1" });
      failing = false;
      t.queue.retry(failed.key);
      await t.settle();
      expect(t.queue.snapshot()[0].status).toBe("done");
      expect(t.deps.actions.requestUpload).toHaveBeenCalledTimes(1);
      expect(t.deps.actions.renewUpload).toHaveBeenCalledWith({ id: "id1", mime: "image/jpeg" });
    });

    it("opakování po chybě u fotografie, která už není čekající (renew vrátí not_found), nahraje novou", async () => {
      let failing = true;
      const renewUpload = vi.fn(async () => ({ status: "not_found" as const }));
      const t = setup({
        put: vi.fn(async () => {
          if (failing) throw new PutError(0);
        }),
      });
      t.deps.actions.renewUpload = renewUpload;
      t.queue.add([file("a.jpg", "image/jpeg")]);
      await t.settle();
      const [failed] = t.queue.snapshot();
      expect(failed).toMatchObject({ status: "error", error: "network", mediaId: "id1" });
      failing = false;
      t.queue.retry(failed.key);
      await t.settle();
      expect(renewUpload).toHaveBeenCalledWith({ id: "id1", mime: "image/jpeg" });
      expect(t.deps.actions.requestUpload).toHaveBeenCalledTimes(2);
      expect(t.queue.snapshot()[0]).toMatchObject({ status: "done", mediaId: "id2" });
    });

    it("chyba klienta (např. 400) se neopakuje", async () => {
      const put = vi.fn(async () => {
        throw new PutError(400);
      });
      const t = setup({ put });
      t.queue.add([file("a.jpg", "image/jpeg")]);
      await t.settle();
      expect(put).toHaveBeenCalledTimes(1);
      expect(t.queue.snapshot()[0]).toMatchObject({ status: "error", error: "network" });
    });

    it("chyby serveru (5xx) se opakují nejvýš třikrát", async () => {
      const put = vi.fn(async () => {
        throw new PutError(503);
      });
      const t = setup({ put });
      t.queue.add([file("a.jpg", "image/jpeg")]);
      await t.settle();
      expect(put).toHaveBeenCalledTimes(3);
    });
  });

  describe("odpovědi serveru", () => {
    it.each([
      ["quota", "quota"],
      ["too_large", "too_large"],
      ["bad_type", "type"],
      ["unavailable", "unavailable"],
      ["limited", "limited"],
      ["not_editable", "closed"],
      ["unauthorized", "closed"],
      ["error", "network"],
    ])("žádost vrátila %s -> chyba %s, nic se nenahrává", async (status, error) => {
      const put = vi.fn();
      const t = setup({
        put,
        actions: {
          requestUpload: vi.fn(async () => ({ status, retryAfter: 5 }) as never),
          renewUpload: vi.fn(),
          finishUpload: vi.fn(),
        },
      });
      t.queue.add([file("a.jpg", "image/jpeg")]);
      await t.settle();
      expect(t.queue.snapshot()[0]).toMatchObject({ status: "error", error });
      expect(put).not.toHaveBeenCalled();
    });

    it("výjimka při žádosti je chyba sítě, ne pád fronty", async () => {
      const t = setup({
        actions: {
          requestUpload: vi.fn(async () => {
            throw new Error("offline");
          }),
          renewUpload: vi.fn(),
          finishUpload: vi.fn(),
        },
      });
      t.queue.add([file("a.jpg", "image/jpeg"), file("b.jpg", "image/jpeg")]);
      await t.settle();
      expect(t.queue.snapshot().map((e) => e.error)).toEqual(["network", "network"]);
    });

    it.each([
      "unsupported_type",
      "heic",
      "too_many_pixels",
      "corrupt",
      "storage",
      "internal",
    ] as const)("zpracování selhalo s kódem %s: chyba se kódem předá rozhraní", async (code) => {
      const t = setup({
        actions: {
          requestUpload: vi.fn(async () => ({
            status: "ok" as const,
            id: "id1",
            url: "https://r2.example/p",
            headers: {},
            expiresInSeconds: 600,
          })),
          renewUpload: vi.fn(),
          finishUpload: vi.fn(async () => ({ status: "failed" as const, code })),
        },
      });
      t.queue.add([file("a.jpg", "image/jpeg")]);
      await t.settle();
      expect(t.queue.snapshot()[0]).toMatchObject({ status: "error", error: code });
    });

    it("„busy“ se po chvíli zopakuje, ztracená odpověď také (dokončení je idempotentní)", async () => {
      const replies = [{ status: "busy" }, "throw", { status: "ok", item: ITEM }] as const;
      let call = 0;
      const t = setup({
        actions: {
          requestUpload: vi.fn(async () => ({
            status: "ok" as const,
            id: "id1",
            url: "https://r2.example/p",
            headers: {},
            expiresInSeconds: 600,
          })),
          renewUpload: vi.fn(),
          finishUpload: vi.fn(async () => {
            const reply = replies[call++];
            if (reply === "throw") throw new Error("síť");
            return reply as never;
          }),
        },
      });
      t.queue.add([file("a.jpg", "image/jpeg")]);
      await t.settle();
      expect(call).toBe(3);
      expect(t.queue.snapshot()[0].status).toBe("done");
    });

    it("trvalé „busy“ skončí chybou", async () => {
      const t = setup({
        actions: {
          requestUpload: vi.fn(async () => ({
            status: "ok" as const,
            id: "id1",
            url: "https://r2.example/p",
            headers: {},
            expiresInSeconds: 600,
          })),
          renewUpload: vi.fn(),
          finishUpload: vi.fn(async () => ({ status: "busy" as const })),
        },
      });
      t.queue.add([file("a.jpg", "image/jpeg")]);
      await t.settle();
      expect(t.queue.snapshot()[0]).toMatchObject({ status: "error", error: "busy" });
    });
  });

  it("odstranění z fronty: jen hotové a chybné položky, ne ta, která se právě nahrává", async () => {
    let release: () => void = () => undefined;
    const t = setup({
      put: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
    });
    t.queue.add([file("a.jpg", "image/jpeg"), file("b.heic", "image/heic")]);
    await new Promise((r) => setTimeout(r, 10));
    const [uploading, heic] = t.queue.snapshot();
    expect(uploading.status).toBe("uploading");
    t.queue.remove(uploading.key);
    expect(t.queue.snapshot()).toHaveLength(2);
    t.queue.remove(heic.key);
    expect(t.queue.snapshot()).toHaveLength(1);
    release();
    await t.settle();
    t.queue.clearFinished();
    expect(t.queue.snapshot()).toHaveLength(0);
  });

  it("po zrušení fronty (odchod ze stránky) se už nic neohlašuje", async () => {
    const t = setup();
    t.queue.add([file("a.jpg", "image/jpeg")]);
    t.queue.dispose();
    const before = t.entries.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(t.entries.length).toBe(before);
  });
});

describe("downscale: volitelné zmenšení v prohlížeči", () => {
  it("bez podpory prohlížeče (OffscreenCanvas, createImageBitmap) vrací původní soubor", async () => {
    const original = file("a.jpg", "image/jpeg", 5000);
    expect(await downscale(original)).toBe(original);
  });

  it("nezmenšuje, co je v mezích; cizí typ nechá být", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 3000, height: 2000, close() {} }));
    vi.stubGlobal("OffscreenCanvas", class {});
    try {
      const original = file("a.jpg", "image/jpeg", 5000);
      expect(await downscale(original)).toBe(original);
      const gif = file("a.gif", "image/gif", 5000);
      expect(await downscale(gif)).toBe(gif);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("nejdelší strana nad 4 000 px se zmenší (JPEG zůstane JPEG, PNG se uloží jako WebP)", async () => {
    const drawn: number[][] = [];
    const types: (string | undefined)[] = [];
    vi.stubGlobal("createImageBitmap", async () => ({ width: 6000, height: 4000, close() {} }));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {
          drawn.push([width, height]);
        }
        getContext() {
          return { drawImage() {} };
        }
        async convertToBlob(options: { type: string }) {
          types.push(options.type);
          return new Blob([new Uint8Array(100)], { type: options.type });
        }
      },
    );
    try {
      const jpg = await downscale(file("a.jpg", "image/jpeg", 5000));
      expect(jpg.type).toBe("image/jpeg");
      const png = await downscale(file("a.png", "image/png", 5000));
      expect(png.type).toBe("image/webp");
      expect(drawn).toEqual([
        [4000, 2667],
        [4000, 2667],
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("zmenšený soubor, který není menší než původní, se nepoužije; chyba vrací původní", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 6000, height: 4000, close() {} }));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { drawImage() {} };
        }
        async convertToBlob() {
          return new Blob([new Uint8Array(9000)], { type: "image/jpeg" });
        }
      },
    );
    try {
      const original = file("a.jpg", "image/jpeg", 5000);
      expect(await downscale(original)).toBe(original);
      vi.stubGlobal("createImageBitmap", async () => {
        throw new Error("nedostatek paměti");
      });
      expect(await downscale(original)).toBe(original);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
