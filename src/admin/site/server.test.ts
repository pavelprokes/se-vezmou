import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.RATE_LIMIT_SECRET = "rate-secret-rate-secret-rate-secret-1";
});

const og = vi.hoisted(() => ({ fetchOgCard: vi.fn(), fetchOgImage: vi.fn() }));
vi.mock("./og", () => og);

import { setTransport } from "@/lib/db/rpc";
import { DbError } from "@/lib/db/transport";
import { publicContentSchema, sensitiveContentSchema } from "@/site/types";
import {
  docToPublic,
  docToWork,
  editorDocSchema,
  normalizeBlocks,
  type EditorBlock,
  type EditorDoc,
} from "./doc";
import {
  checkpointDue,
  createCheckpoint,
  loadSite,
  publishSiteVersion,
  refreshGalleryCard,
  restoreVersion,
  saveSite,
  setQuickNotice,
  unpublishSite,
} from "./server";

const WEDDING = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const SESSION = { weddingId: WEDDING, subjectId: ADMIN };
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function baseDoc(): EditorDoc {
  const doc = editorDocSchema.parse({
    wedding: {
      partnerA: "Klára",
      partnerB: "Matěj",
      startsOn: "2027-06-19",
      endsOn: null,
      timezone: "Europe/Prague",
      locales: ["cs", "en"],
      defaultLocale: "cs",
      template: "chateau",
      palette: "slonovina",
    },
    venues: [
      {
        id: ID(1),
        name: { cs: "Zámek" },
        address: "Zámecká 1",
        isPrivate: false,
        directions: null,
        mapUrl: null,
      },
    ],
    events: [
      {
        id: ID(3),
        kind: "ceremony",
        title: { cs: "Obřad", en: "Ceremony" },
        description: null,
        startsAt: "2027-06-19T14:00:00+02:00",
        endsAt: null,
        venueId: ID(1),
        rsvpEnabled: true,
      },
    ],
    blocks: [],
  });
  return {
    ...doc,
    blocks: normalizeBlocks(doc.blocks).map((b) =>
      b.type === "gifts"
        ? ({
            ...b,
            enabled: true,
            data: { ...b.data, account: "19-2000145399/0800", holder: "Klára" },
          } as EditorBlock)
        : b,
    ),
  };
}

function rawLoad(
  doc: EditorDoc,
  meta: Partial<{
    status: string;
    slug: string | null;
    rev: number;
    published_version_no: number | null;
    has_unpublished_changes: boolean;
    has_guest_pin: boolean;
    guest_pin_enabled: boolean;
    quick_notice: unknown;
    quick_notice_enabled: boolean;
  }> = {},
  versions: unknown[] = [],
  blocksOverride?: unknown[],
) {
  const w = doc.wedding;
  return {
    wedding: {
      id: WEDDING,
      status: meta.status ?? "published",
      slug: meta.slug === undefined ? "klara-a-matej" : meta.slug,
      default_locale: w.defaultLocale,
      locales: w.locales,
      template: w.template,
      palette: w.palette,
      partner_a_name: w.partnerA,
      partner_b_name: w.partnerB,
      starts_on: w.startsOn,
      ends_on: w.endsOn,
      timezone: w.timezone,
      quick_notice: meta.quick_notice ?? null,
      quick_notice_enabled: meta.quick_notice_enabled ?? false,
      guest_pin_enabled: meta.guest_pin_enabled ?? true,
      has_guest_pin: meta.has_guest_pin ?? true,
      site_rev: meta.rev ?? 4,
      draft_saved_at: null,
      published_at: null,
      published_version_no: meta.published_version_no === undefined ? 2 : meta.published_version_no,
      published_version_at: null,
      has_unpublished_changes: meta.has_unpublished_changes ?? true,
    },
    venues: doc.venues.map((v) => ({
      id: v.id,
      name: v.name,
      address: v.address,
      is_private: v.isPrivate,
      directions: v.directions,
      map_url: v.mapUrl,
    })),
    events: doc.events.map((e) => ({
      id: e.id,
      kind: e.kind,
      title: e.title,
      description: e.description,
      starts_at: e.startsAt,
      ends_at: e.endsAt,
      venue_id: e.venueId,
      rsvp_enabled: e.rsvpEnabled,
    })),
    blocks:
      blocksOverride ??
      doc.blocks.map((b) => ({
        id: b.id,
        type: b.type,
        anchor: b.anchor,
        enabled: b.enabled,
        position: b.position,
        sensitive: b.sensitive,
        data: b.data,
      })),
    versions,
  };
}

type Call = { fn: string; args: Record<string, unknown> };

function fakeDb(
  options: {
    raw?: unknown;
    rateAllowed?: boolean;
    save?: { ok: boolean; conflict: boolean; rev: number };
    fail?: Record<string, DbError>;
    versionGet?: unknown;
    media?: unknown;
  } = {},
) {
  const calls: Call[] = [];
  const raw = options.raw ?? rawLoad(baseDoc());
  setTransport({
    async call(fn, args) {
      calls.push({ fn, args });
      if (options.fail?.[fn]) throw options.fail[fn];
      switch (fn) {
        case "rate_limit_hit": {
          const allowed = options.rateAllowed ?? true;
          return [{ allowed, retry_after: allowed ? 0 : 99 }];
        }
        case "admin_site_load":
          return raw;
        case "admin_site_save":
          return [options.save ?? { ok: true, conflict: false, rev: 5 }];
        case "admin_site_publish":
          return [{ version_no: 3, slug: "klara-a-matej" }];
        case "admin_site_checkpoint":
          return [{ version_no: 4 }];
        case "admin_site_unpublish":
        case "admin_quick_notice_set":
        case "analytics_record":
          return null;
        case "admin_site_version_get":
          return options.versionGet ?? null;
        case "admin_media_list":
          return options.media ?? [];
        default:
          throw new Error(`Neočekávané volání ${fn}`);
      }
    },
  });
  return calls;
}

afterEach(() => {
  setTransport(null);
  og.fetchOgCard.mockReset();
  og.fetchOgImage.mockReset();
});

describe("saveSite", () => {
  it("uloží pracovní kopii s číslem revize a vrátí novou revizi", async () => {
    const calls = fakeDb();
    const doc = baseDoc();
    const result = await saveSite(SESSION, { doc, baseRev: 4 });
    expect(result).toEqual({ status: "saved", rev: 5 });
    const save = calls.find((c) => c.fn === "admin_site_save")!;
    expect(save.args.p_base_rev).toBe(4);
    expect(save.args.p_work).toEqual(docToWork(doc));
  });

  it("konflikt revize se hlásí, nic se nepřepisuje", async () => {
    fakeDb({ save: { ok: false, conflict: true, rev: 9 } });
    expect(await saveSite(SESSION, { doc: baseDoc(), baseRev: 4 })).toEqual({
      status: "conflict",
      rev: 9,
    });
  });

  it("neplatný dokument a neznámá paleta se odmítnou ještě před databází", async () => {
    const calls = fakeDb();
    expect(await saveSite(SESSION, { doc: { blocks: "x" }, baseRev: 1 })).toEqual({
      status: "invalid",
    });
    const bad = baseDoc();
    bad.wedding.palette = "neexistuje";
    expect(await saveSite(SESSION, { doc: bad, baseRev: 1 })).toEqual({ status: "invalid" });
    expect(await saveSite(SESSION, { doc: baseDoc(), baseRev: -1 })).toEqual({ status: "invalid" });
    expect(await saveSite(SESSION, { doc: baseDoc(), baseRev: 1.5 })).toEqual({
      status: "invalid",
    });
    expect(calls.filter((c) => c.fn === "admin_site_save")).toEqual([]);
  });

  it("překročení limitu ukládání nic neuloží", async () => {
    const calls = fakeDb({ rateAllowed: false });
    expect(await saveSite(SESSION, { doc: baseDoc(), baseRev: 1 })).toEqual({
      status: "limited",
      retryAfter: 99,
    });
    expect(calls.some((c) => c.fn === "admin_site_save")).toBe(false);
  });

  it("databázové chyby se mapují na stav, neznámá chyba projde dál", async () => {
    fakeDb({
      fail: { admin_site_save: new DbError("admin_site_save", "55000", "site_not_editable") },
    });
    expect(await saveSite(SESSION, { doc: baseDoc(), baseRev: 1 })).toEqual({
      status: "not_editable",
    });
    fakeDb({ fail: { admin_site_save: new DbError("admin_site_save", "23514", "chyba SQL") } });
    expect(await saveSite(SESSION, { doc: baseDoc(), baseRev: 1 })).toEqual({ status: "invalid" });
    fakeDb({
      fail: { admin_site_save: new DbError("admin_site_save", undefined, "chyba spojení") },
    });
    await expect(saveSite(SESSION, { doc: baseDoc(), baseRev: 1 })).rejects.toBeInstanceOf(DbError);
  });
});

describe("publishSiteVersion", () => {
  it("snímek se sestaví z uloženého konceptu a citlivá část jde zvlášť", async () => {
    const doc = baseDoc();
    const calls = fakeDb({ raw: rawLoad(doc) });
    const result = await publishSiteVersion(SESSION, "  Nový program  ");
    expect(result).toMatchObject({ status: "published", versionNo: 3, slug: "klara-a-matej" });
    const publish = calls.find((c) => c.fn === "admin_site_publish")!;
    expect(publicContentSchema.safeParse(publish.args.p_public).success).toBe(true);
    expect(sensitiveContentSchema.safeParse(publish.args.p_sensitive).success).toBe(true);
    expect(JSON.stringify(publish.args.p_public)).not.toContain("19-2000145399");
    expect(JSON.stringify(publish.args.p_sensitive)).toContain("19-2000145399/0800");
    expect(publish.args.p_note).toBe("Nový program");
    expect(calls.find((c) => c.fn === "analytics_record")?.args).toEqual({
      p_event: "site_published",
      p_locale: "cs",
      p_template: "chateau",
      p_step: null,
    });
    // Snímek je stejný, jaký by sestavil editor.
    const expected = docToPublic(doc, { slug: "klara-a-matej" })!;
    expect((publish.args.p_public as { blocks: unknown }).blocks).toEqual(expected.content.blocks);
  });

  it("neúplný web (chybí datum) nejde zveřejnit, databáze se nezavolá", async () => {
    const doc = baseDoc();
    doc.wedding.startsOn = "";
    const calls = fakeDb({ raw: rawLoad(doc) });
    const result = await publishSiteVersion(SESSION);
    expect(result).toMatchObject({ status: "invalid" });
    expect(result.status === "invalid" && result.issues.some((i) => i.code === "date")).toBe(true);
    expect(calls.some((c) => c.fn === "admin_site_publish")).toBe(false);
  });

  it("paleta s chybou kontrastu zveřejnění zastaví (validatePalette)", async () => {
    const doc = baseDoc();
    doc.wedding.palette = "neexistuje";
    fakeDb({ raw: rawLoad(doc) });
    const result = await publishSiteVersion(SESSION);
    expect(result.status === "invalid" && result.issues.some((i) => i.code === "palette")).toBe(
      true,
    );
  });

  it("chybějící překlad zveřejnění nebrání, jen se hlásí v upozornění", async () => {
    const doc = baseDoc();
    doc.venues[0].name = { cs: "Zámek" };
    fakeDb({ raw: rawLoad(doc) });
    const result = await publishSiteVersion(SESSION);
    expect(result.status).toBe("published");
  });

  it("web bez adresy a chyby databáze se hlásí stavem", async () => {
    fakeDb({ raw: rawLoad(baseDoc(), { slug: null }) });
    expect(await publishSiteVersion(SESSION)).toEqual({ status: "not_publishable" });
    fakeDb({
      fail: { admin_site_publish: new DbError("admin_site_publish", "55000", "slug_not_reserved") },
    });
    expect(await publishSiteVersion(SESSION)).toEqual({ status: "not_publishable" });
    fakeDb({
      fail: { admin_site_publish: new DbError("admin_site_publish", "55000", "guest_pin_missing") },
    });
    expect(await publishSiteVersion(SESSION)).toMatchObject({ status: "invalid" });
  });

  it("limit zveřejnění", async () => {
    const calls = fakeDb({ rateAllowed: false });
    expect(await publishSiteVersion(SESSION)).toMatchObject({ status: "limited" });
    expect(calls.some((c) => c.fn === "admin_site_publish")).toBe(false);
  });
});

describe("stažení z publikace, bod pro vrácení", () => {
  it("stažení volá databázi, druhé stažení hlásí neúspěch", async () => {
    const calls = fakeDb();
    expect(await unpublishSite(SESSION)).toEqual({ status: "ok" });
    expect(calls.some((c) => c.fn === "admin_site_unpublish")).toBe(true);
    fakeDb({
      fail: {
        admin_site_unpublish: new DbError("admin_site_unpublish", "55000", "wedding_not_published"),
      },
    });
    expect(await unpublishSite(SESSION)).toEqual({ status: "failed" });
  });

  it("bod pro vrácení nese poznámku a je platný snímek; nehotový koncept se nezachytí", async () => {
    const calls = fakeDb();
    expect(await createCheckpoint(SESSION, "před úpravou")).toEqual({ status: "ok", versionNo: 4 });
    const cp = calls.find((c) => c.fn === "admin_site_checkpoint")!;
    expect(cp.args.p_note).toBe("před úpravou");
    expect(publicContentSchema.safeParse(cp.args.p_public).success).toBe(true);

    const doc = baseDoc();
    doc.wedding.startsOn = "";
    const calls2 = fakeDb({ raw: rawLoad(doc) });
    expect(await createCheckpoint(SESSION, null)).toEqual({ status: "invalid" });
    expect(calls2.some((c) => c.fn === "admin_site_checkpoint")).toBe(false);
  });
});

describe("restoreVersion: vrácení verze jako konceptu", () => {
  const VERSION = "33333333-3333-4333-8333-333333333333";

  function oldVersion() {
    const doc = baseDoc();
    doc.wedding.template = "modern";
    doc.wedding.palette = "kobalt";
    doc.events[0].title = { cs: "Starý obřad" };
    const built = docToPublic(doc, { slug: "klara-a-matej" })!;
    return { public_content: built.content, sensitive_content: built.sensitive };
  }

  it("nejdřív uloží současný stav jako bod pro vrácení, pak načte snímek do konceptu", async () => {
    const versions = [
      {
        id: VERSION,
        version_no: 1,
        kind: "publish",
        note: null,
        created_at: "2026-10-01T10:00:00Z",
        is_published: false,
        by_me: true,
      },
    ];
    const calls = fakeDb({ raw: rawLoad(baseDoc(), {}, versions), versionGet: oldVersion() });
    const result = await restoreVersion(SESSION, VERSION);
    expect(result).toEqual({ status: "restored", rev: 5, versionNo: 1 });
    const order = calls
      .map((c) => c.fn)
      .filter((fn) => fn === "admin_site_checkpoint" || fn === "admin_site_save");
    expect(order).toEqual(["admin_site_checkpoint", "admin_site_save"]);
    const save = calls.find((c) => c.fn === "admin_site_save")!;
    expect(save.args.p_base_rev).toBe(4);
    const work = save.args.p_work as {
      wedding: { template: string };
      events: { title: unknown }[];
    };
    expect(work.wedding.template).toBe("modern");
    expect(work.events[0].title).toEqual({ cs: "Starý obřad" });
    expect(calls.some((c) => c.fn === "admin_site_publish")).toBe(false);
  });

  it("neznámá verze se nevrací; verze cizí svatby (databáze vrátí null) také ne", async () => {
    const calls = fakeDb({ raw: rawLoad(baseDoc(), {}, []) });
    expect(await restoreVersion(SESSION, VERSION)).toEqual({ status: "not_found" });
    expect(calls.some((c) => c.fn === "admin_site_save")).toBe(false);

    const versions = [
      {
        id: VERSION,
        version_no: 1,
        kind: "publish",
        note: null,
        created_at: "2026-10-01T10:00:00Z",
        is_published: false,
        by_me: true,
      },
    ];
    const calls2 = fakeDb({ raw: rawLoad(baseDoc(), {}, versions), versionGet: null });
    expect(await restoreVersion(SESSION, VERSION)).toEqual({ status: "not_found" });
    expect(calls2.some((c) => c.fn === "admin_site_save")).toBe(false);
  });

  it("konflikt při uložení se hlásí", async () => {
    const versions = [
      {
        id: VERSION,
        version_no: 1,
        kind: "publish",
        note: null,
        created_at: "2026-10-01T10:00:00Z",
        is_published: false,
        by_me: true,
      },
    ];
    fakeDb({
      raw: rawLoad(baseDoc(), {}, versions),
      versionGet: oldVersion(),
      save: { ok: false, conflict: true, rev: 8 },
    });
    expect(await restoreVersion(SESSION, VERSION)).toEqual({ status: "conflict" });
  });
});

describe("loadSite: pracovní kopie z publikace", () => {
  it("web zveřejněný bez pracovní kopie se naplní ze zveřejněné verze", async () => {
    const versions = [
      {
        id: "44444444-4444-4444-8444-444444444444",
        version_no: 2,
        kind: "publish",
        note: null,
        created_at: "2026-10-01T10:00:00Z",
        is_published: true,
        by_me: false,
      },
    ];
    const built = docToPublic(baseDoc(), { slug: "klara-a-matej" })!;
    const calls = fakeDb({
      raw: rawLoad(baseDoc(), {}, versions, []),
      versionGet: { public_content: built.content, sensitive_content: built.sensitive },
    });
    const loaded = await loadSite(SESSION);
    expect(loaded).not.toBeNull();
    const save = calls.find((c) => c.fn === "admin_site_save");
    expect(save).toBeDefined();
    const work = save!.args.p_work as { blocks: { type: string; data: Record<string, unknown> }[] };
    const gifts = work.blocks.find((b) => b.type === "gifts");
    expect(gifts?.data.account).toBe("19-2000145399/0800");
  });

  it("web s pracovní kopií se znovu nepřepisuje", async () => {
    const calls = fakeDb();
    await loadSite(SESSION);
    expect(calls.some((c) => c.fn === "admin_site_save")).toBe(false);
  });
});

describe("checkpointDue", () => {
  it("jen s nezveřejněnými změnami a starou poslední verzí", async () => {
    const stale = {
      id: "x",
      version_no: 2,
      kind: "publish",
      note: null,
      created_at: "2026-10-01T10:00:00Z",
      is_published: true,
      by_me: false,
    };
    fakeDb({ raw: rawLoad(baseDoc(), { has_unpublished_changes: true }, [stale]) });
    const loaded = (await loadSite(SESSION))!;
    const base = new Date("2026-10-01T10:00:00Z").getTime();
    expect(checkpointDue(loaded, base + 31 * 60_000)).toBe(true);
    expect(checkpointDue(loaded, base + 10 * 60_000)).toBe(false);
    fakeDb({ raw: rawLoad(baseDoc(), { has_unpublished_changes: false }, [stale]) });
    expect(checkpointDue((await loadSite(SESSION))!, base + 99 * 60_000)).toBe(false);
  });
});

describe("setQuickNotice", () => {
  it("uloží text bez prázdných jazyků", async () => {
    const calls = fakeDb();
    expect(
      await setQuickNotice(SESSION, { notice: { cs: "  Změna  ", en: "" }, enabled: true }),
    ).toEqual({ status: "ok" });
    expect(calls.find((c) => c.fn === "admin_quick_notice_set")?.args).toEqual({
      p_notice: { cs: "Změna" },
      p_enabled: true,
    });
  });

  it("zapnout prázdný pruh nejde, neplatný vstup ani neznámý jazyk", async () => {
    const calls = fakeDb();
    expect(await setQuickNotice(SESSION, { notice: { cs: " " }, enabled: true })).toEqual({
      status: "empty",
    });
    expect(await setQuickNotice(SESSION, { notice: { de: "x" }, enabled: true })).toEqual({
      status: "invalid",
    });
    expect(
      await setQuickNotice(SESSION, { notice: { cs: "x".repeat(501) }, enabled: false }),
    ).toEqual({ status: "invalid" });
    expect(await setQuickNotice(SESSION, "nic")).toEqual({ status: "invalid" });
    expect(calls.some((c) => c.fn === "admin_quick_notice_set")).toBe(false);
  });
});

describe("refreshGalleryCard", () => {
  it("neplatný odkaz se nenačítá, limit se hlídá podle svatby", async () => {
    fakeDb();
    expect(await refreshGalleryCard(SESSION, "http://fotky.example")).toEqual({
      status: "invalid_url",
    });
    expect(og.fetchOgCard).not.toHaveBeenCalled();

    fakeDb({ rateAllowed: false });
    expect(await refreshGalleryCard(SESSION, "https://fotky.example/a")).toEqual({
      status: "limited",
      retryAfter: 99,
    });
    expect(og.fetchOgCard).not.toHaveBeenCalled();
  });

  it("úspěch i selhání vrací kartu, nikdy výjimku", async () => {
    fakeDb();
    const card = {
      title: "Galerie",
      description: null,
      imageUrl: null,
      fetchedAt: "2026-10-02T10:00:00.000Z",
      imageMediaId: null,
      status: "ok",
    };
    og.fetchOgCard.mockResolvedValueOnce({ ok: true, card });
    expect(await refreshGalleryCard(SESSION, "fotky.example/a")).toEqual({ status: "ok", card });
    expect(og.fetchOgCard).toHaveBeenCalledWith("https://fotky.example/a");

    const failed = { ...card, title: null, status: "failed" };
    og.fetchOgCard.mockResolvedValueOnce({ ok: false, reason: "timeout", card: failed });
    expect(await refreshGalleryCard(SESSION, "https://fotky.example/a")).toEqual({
      status: "failed",
      reason: "timeout",
      card: failed,
    });
  });
});
