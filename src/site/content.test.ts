import { afterEach, describe, expect, it, vi } from "vitest";

// `cache` z Reactu mimo vykreslení nic nesdílí; pro test ho nahradíme prostou memoizací podle prvního argumentu,
// což je, co dělá při jednom vykreslení stránky.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
      const memo = new Map<unknown, R>();
      return (...args: A) => {
        if (!memo.has(args[0])) memo.set(args[0], fn(...args));
        return memo.get(args[0]) as R;
      };
    },
  };
});

const guest = vi.hoisted(() => ({
  session: null as null | { sessionId: string; weddingId: string },
}));
vi.mock("@/auth/guest-session", () => ({
  getGuestSession: async () => guest.session,
  guestIdentity: (access: { sessionId: string; weddingId: string }) => ({
    weddingId: access.weddingId,
    weddingRole: "guest_pin",
    subject: access.sessionId,
  }),
}));

import type { RpcOptions } from "@/lib/db/rpc";
import { eukalyptusFixture } from "./fixtures/klara-a-matej";

/** Čerstvé moduly pro každý test: mezipaměť `cache` je na úrovni modulu, tedy sdílená mezi testy. */
async function load() {
  vi.resetModules();
  const rpc = await import("@/lib/db/rpc");
  const content = await import("./content");
  return { rpc, getPublicContent: content.getPublicContent, getSiteState: content.getSiteState };
}

const WEDDING = "11111111-1111-4111-8111-111111111111";

function snapshot() {
  // platný snímek (prochází schématem veřejného obsahu)
  return JSON.parse(JSON.stringify(eukalyptusFixture));
}

function fakeDb(
  setTransport: (t: import("@/lib/db/transport").RpcTransport | null) => void,
  locked = false,
) {
  const calls: { fn: string; options?: RpcOptions; role?: string }[] = [];
  setTransport({
    async call(fn, _args, _kind, as, options) {
      const role = (as as { weddingRole?: string } | undefined)?.weddingRole;
      calls.push({ fn, options, role });
      switch (fn) {
        case "resolve_slug":
          return [
            {
              wedding_id: WEDDING,
              status: "published",
              default_locale: "cs",
              locales: ["cs"],
              template: "chateau",
            },
          ];
        case "get_public_site":
          if (locked && role === "visitor") {
            const { partners, locales, defaultLocale, template, palette } = snapshot();
            return {
              mode: "locked",
              phase: "rsvp_open",
              locked: { partners, locales, defaultLocale, template, palette },
            };
          }
          return { mode: "published", phase: "rsvp_open", content: snapshot(), quick_notice: null };
        case "public_media_ids":
          return [];
        default:
          throw new Error(`Neočekávané volání ${fn}`);
      }
    },
  });
  return calls;
}

afterEach(() => {
  vi.resetModules();
  guest.session = null;
});

describe("jeden požadavek, jedno načtení webu", () => {
  it("generateMetadata a stránka sdílejí výsledek getPublicContent (jeden dotaz do databáze)", async () => {
    const { rpc, getPublicContent } = await load();
    const calls = fakeDb(rpc.setTransport);
    const [first, second] = await Promise.all([
      getPublicContent("klara-a-matej"),
      getPublicContent("klara-a-matej"),
    ]);
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(calls.filter((c) => c.fn === "resolve_slug")).toHaveLength(1);
    expect(calls.filter((c) => c.fn === "get_public_site")).toHaveLength(1);
  });

  it("resolveSlug se v jednom požadavku sdílí i s načtením živých dat hosta", async () => {
    const { rpc, getPublicContent } = await load();
    const calls = fakeDb(rpc.setTransport);
    await getPublicContent("klara-a-matej");
    await rpc.resolveSlug("klara-a-matej");
    expect(calls.filter((c) => c.fn === "resolve_slug")).toHaveLength(1);
  });

  it("jiná adresa se nesdílí", async () => {
    const { rpc, getPublicContent } = await load();
    const calls = fakeDb(rpc.setTransport);
    await getPublicContent("klara-a-matej");
    await getPublicContent("jina-adresa");
    expect(calls.filter((c) => c.fn === "resolve_slug")).toHaveLength(2);
  });

  it("čtecí volání jsou označená readOnly (commit nečeká před odpovědí)", async () => {
    const { rpc, getPublicContent } = await load();
    const calls = fakeDb(rpc.setTransport);
    await getPublicContent("klara-a-matej");
    for (const call of calls) expect(call.options).toEqual({ readOnly: true });
  });
});

describe("zamčený web (heslo na celý web)", () => {
  it("bez relace hosta jen brána, obsah se nevydá", async () => {
    const { rpc, getSiteState, getPublicContent } = await load();
    const calls = fakeDb(rpc.setTransport, true);
    const state = await getSiteState("klara-a-matej");
    expect(state).toMatchObject({ kind: "locked", gate: { partners: { a: "Klára", b: "Matěj" } } });
    expect(await getPublicContent("klara-a-matej")).toBeNull();
    expect(calls.filter((c) => c.fn === "public_media_ids")).toHaveLength(0);
  });

  it("host po PINu dostane obsah a fotografie se čtou jeho totožností", async () => {
    guest.session = { sessionId: "s1", weddingId: WEDDING };
    const { rpc, getSiteState } = await load();
    const calls = fakeDb(rpc.setTransport, true);
    expect((await getSiteState("klara-a-matej"))?.kind).toBe("published");
    const roles = (fn: string) => calls.filter((c) => c.fn === fn).map((c) => c.role);
    expect(roles("get_public_site")).toEqual(["visitor", "guest_pin"]);
    for (const role of roles("public_media_ids")) expect(role).toBe("guest_pin");
  });
});
