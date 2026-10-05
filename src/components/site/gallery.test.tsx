// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({
  unlockAction: vi.fn(),
  matchAction: vi.fn(),
  unlistedAction: vi.fn(),
  submitAction: vi.fn(),
  resetAction: vi.fn(),
}));

import { eukalyptusFixture } from "@/site/fixtures/klara-a-matej";
import type { PublicContent, PublicMedia, SensitiveContent } from "@/site/types";
import { locales, type Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { SITE_NAMESPACES, type SiteTranslator } from "./context";
import { SiteRenderer } from "./site-renderer";

/**
 * Fotografie páru na webu (M7c): `<picture>` se `srcset` (AVIF před WebP, rozměry, líné načítání), přístupný
 * prohlížeč, popisky a dekorativní fotografie, fotografie chráněné PINem a kopie obrázku karty.
 */

const NOW = new Date("2026-10-02T10:00:00+02:00");
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function media(n: number, patch: Partial<PublicMedia> = {}): PublicMedia {
  return {
    id: ID(n),
    src: `/media/${ID(n)}/1920`,
    width: 1920,
    height: 1280,
    alt: { cs: `Pár číslo ${n}`, en: `Couple ${n}` },
    decorative: false,
    widths: [640, 1280, 1920],
    ...patch,
  };
}

function withGallery(
  items: PublicMedia[],
  data: Record<string, unknown> = {},
  base: PublicContent = eukalyptusFixture,
): PublicContent {
  return {
    ...base,
    media: items,
    blocks: base.blocks.map((b) =>
      b.type === "gallery"
        ? {
            ...b,
            enabled: true,
            data: {
              mediaIds: items.map((m) => m.id),
              photosProtected: false,
              link: null,
              ...data,
            },
          }
        : b,
    ),
  } as PublicContent;
}

/** Překlady webu páru v každém jazyce (stejně jako je stránka načte na serveru). */
const translators = Object.fromEntries(
  await Promise.all(
    locales.map(async (locale) => [locale, await getTranslator(locale, SITE_NAMESPACES)] as const),
  ),
) as Record<Locale, SiteTranslator>;

function renderSite(
  content: PublicContent,
  locale: Locale = "cs",
  extra: Partial<Parameters<typeof SiteRenderer>[0]> = {},
) {
  return render(<SiteRenderer content={content} t={translators[locale]} now={NOW} {...extra} />);
}

beforeAll(() => {
  // jsdom neumí nativní modální dialog: stačí přepínat atribut `open` (skutečné chování ověřuje e2e)
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

describe("fotografie v mřížce: picture a srcset", () => {
  it("AVIF před WebP, šířky variant, rozměry, líné načítání a vlastní adresy", () => {
    const { container } = renderSite(withGallery([media(1)]));
    const picture = container.querySelector("#galerie picture")!;
    const sources = [...picture.querySelectorAll("source")];
    expect(sources.map((s) => s.getAttribute("type"))).toEqual(["image/avif", "image/webp"]);
    expect(sources[0].getAttribute("srcset")).toBe(
      `/media/${ID(1)}/640?f=avif 640w, /media/${ID(1)}/1280?f=avif 1280w, /media/${ID(1)}/1920?f=avif 1920w`,
    );
    expect(sources[1].getAttribute("srcset")).toBe(
      `/media/${ID(1)}/640?f=webp 640w, /media/${ID(1)}/1280?f=webp 1280w, /media/${ID(1)}/1920?f=webp 1920w`,
    );
    expect(sources[0].getAttribute("sizes")).toBe("(min-width: 768px) 30vw, 100vw");
    const img = picture.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(`/media/${ID(1)}/1920?f=webp`);
    expect(img).toHaveAttribute("width", "1920");
    expect(img).toHaveAttribute("height", "1280");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
    expect(img).toHaveAttribute("alt", "Pár číslo 1");
  });

  it("web nenačítá nic z cizího původu", () => {
    const { container } = renderSite(withGallery([media(1), media(2)]));
    const urls = [...container.querySelectorAll("[src], [srcset], link[href], iframe")].flatMap(
      (el) => [el.getAttribute("src"), ...(el.getAttribute("srcset")?.split(",") ?? [])],
    );
    expect(urls.filter((u) => u && /https?:\/\//.test(u))).toEqual([]);
  });

  it("starší snímek a fixtura bez šířek variant: jediný obrázek na src", () => {
    const { container } = renderSite(
      withGallery([media(1, { widths: [], src: "/fixtures/zahrada.svg" })]),
    );
    expect(container.querySelector("#galerie picture")).toBeNull();
    const img = container.querySelector("#galerie img")!;
    expect(img.getAttribute("src")).toBe("/fixtures/zahrada.svg");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("width", "1920");
  });

  it("popisek v jiném jazyce, než je jazyk stránky, nese lang (WCAG 3.1.2)", () => {
    const { container } = renderSite(withGallery([media(1, { alt: { cs: "Jen česky" } })]), "en");
    expect(container.querySelector("#galerie img")).toHaveAttribute("lang", "cs");
    expect(container.querySelector("#galerie img")).toHaveAttribute("alt", "Jen česky");
  });
});

describe("popisek povinný nebo dekorativní (WCAG 1.1.1)", () => {
  it("bez popisku a bez příznaku dekorativní se fotografie nevykreslí, dekorativní má prázdné alt", () => {
    const { container } = renderSite(
      withGallery([
        media(1, { alt: null }),
        media(2, { alt: null, decorative: true }),
        media(3, { alt: { cs: "  " } }),
        media(4),
      ]),
    );
    const images = [...container.querySelectorAll("#galerie img")];
    expect(images.map((i) => i.getAttribute("alt"))).toEqual(["", "Pár číslo 4"]);
  });

  it("dekorativní fotografie nemá lang ani popisek, ale tlačítko má název", () => {
    renderSite(withGallery([media(1, { alt: null, decorative: true }), media(2)]));
    // (typografie vkládá za jednopísmenné předložky nezlomitelnou mezeru)
    expect(
      screen.getByRole("button", { name: /^Zvětšit fotografii 1\sz\s2$/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Zvětšit fotografii: Pár číslo 2" }),
    ).toBeInTheDocument();
  });

  it("galerie jen s nepopsanými fotografiemi (bez odkazu) se nevykreslí a není v navigaci", () => {
    const { container } = renderSite(withGallery([media(1, { alt: null })]));
    expect(container.querySelector("#galerie")).toBeNull();
    expect(container.querySelector('nav a[href="#galerie"]')).toBeNull();
  });
});

describe("přístupný prohlížeč (lightbox)", () => {
  async function open(n = 3) {
    const items = Array.from({ length: n }, (_, i) => media(i + 1));
    const user = userEvent.setup();
    const { container } = renderSite(withGallery(items));
    const trigger = screen.getByRole("button", { name: "Zvětšit fotografii: Pár číslo 2" });
    await user.click(trigger);
    const dialog = container.querySelector("dialog")!;
    return { user, dialog, trigger, container };
  }

  it("dialog má název, otevře se na vybrané fotografii a nese alt text i viditelný popisek s pořadím", async () => {
    const { dialog } = await open();
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveAttribute("aria-label", "Prohlížeč fotografií");
    const img = dialog.querySelector("img")!;
    expect(img).toHaveAttribute("alt", "Pár číslo 2");
    expect(img).toHaveAttribute("loading", "eager");
    expect(dialog.querySelector("source")?.getAttribute("sizes")).toBe("100vw");
    expect(within(dialog).getByText("Pár číslo 2")).toBeVisible();
    expect(within(dialog).getByText("Fotografie 2 z 3")).toBeInTheDocument();
    // změna fotografie se ohlašuje
    expect(dialog.querySelector("figcaption")).toHaveAttribute("aria-live", "polite");
  });

  it("zavřený prohlížeč nenačítá velké obrázky (v dialogu nic není)", () => {
    const { container } = renderSite(withGallery([media(1), media(2)]));
    expect(container.querySelector("dialog")!.children).toHaveLength(0);
  });

  it("tlačítka Zavřít, Předchozí a Další mají názvy; Další a Předchozí se točí dokola", async () => {
    const { user, dialog } = await open();
    const next = within(dialog).getByRole("button", { name: "Další fotografie" });
    const prev = within(dialog).getByRole("button", { name: "Předchozí fotografie" });
    expect(within(dialog).getByRole("button", { name: "Zavřít prohlížeč" })).toBeInTheDocument();
    await user.click(next);
    expect(within(dialog).getByText("Fotografie 3 z 3")).toBeInTheDocument();
    await user.click(next);
    expect(within(dialog).getByText("Fotografie 1 z 3")).toBeInTheDocument();
    await user.click(prev);
    expect(within(dialog).getByText("Fotografie 3 z 3")).toBeInTheDocument();
  });

  it("šipky, Home a End listují z klávesnice", async () => {
    const { user, dialog } = await open();
    const close = within(dialog).getByRole("button", { name: "Zavřít prohlížeč" });
    close.focus();
    await user.keyboard("{ArrowRight}");
    expect(within(dialog).getByText("Fotografie 3 z 3")).toBeInTheDocument();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(within(dialog).getByText("Fotografie 1 z 3")).toBeInTheDocument();
    await user.keyboard("{End}");
    expect(within(dialog).getByText("Fotografie 3 z 3")).toBeInTheDocument();
    await user.keyboard("{Home}");
    expect(within(dialog).getByText("Fotografie 1 z 3")).toBeInTheDocument();
  });

  it("zaměření je v dialogu uvězněné: Tab z posledního prvku na první a Shift+Tab zpět", async () => {
    const { user, dialog } = await open();
    const buttons = within(dialog).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Zavřít prohlížeč",
      "Předchozí fotografie",
      "Další fotografie",
    ]);
    buttons[2].focus();
    await user.tab();
    expect(buttons[0]).toHaveFocus();
    await user.tab({ shift: true });
    expect(buttons[2]).toHaveFocus();
  });

  it("zavření vrátí zaměření na fotografii, ze které se prohlížeč otevřel", async () => {
    const { user, dialog, trigger } = await open();
    await user.click(within(dialog).getByRole("button", { name: "Zavřít prohlížeč" }));
    expect(dialog).not.toHaveAttribute("open");
    expect(dialog.children).toHaveLength(0);
    expect(trigger).toHaveFocus();
  });

  it("klik na pozadí zavře prohlížeč", async () => {
    const { user, dialog } = await open();
    await user.click(dialog);
    expect(dialog).not.toHaveAttribute("open");
  });

  it("jedna fotografie nemá tlačítka pro listování", async () => {
    const user = userEvent.setup();
    const { container } = renderSite(withGallery([media(1)]));
    await user.click(screen.getByRole("button", { name: /Zvětšit fotografii/ }));
    const dialog = container.querySelector("dialog")!;
    expect(within(dialog).queryByRole("button", { name: "Další fotografie" })).toBeNull();
    expect(within(dialog).getByText("Fotografie 1 z 1")).toBeInTheDocument();
  });

  it("anglicky: názvy a popisky v angličtině", async () => {
    const user = userEvent.setup();
    const { container } = renderSite(withGallery([media(1), media(2)]), "en");
    await user.click(screen.getByRole("button", { name: "Enlarge photo: Couple 1" }));
    const dialog = container.querySelector("dialog")!;
    expect(dialog).toHaveAttribute("aria-label", "Photo viewer");
    expect(within(dialog).getByText("Photo 1 of 2")).toBeInTheDocument();
  });
});

describe("fotografie chráněné PINem hostů", () => {
  const secret = (photos: PublicMedia[]): SensitiveContent => ({
    venues: {},
    gifts: null,
    gallery: null,
    photos,
  });
  const protectedContent = () => withGallery([], { photosProtected: true });

  it("zamčeno: v HTML nejsou fotografie, popisky ani adresy, jen formulář PINu", () => {
    const { container } = renderSite(protectedContent(), "cs", {
      sensitive: secret([media(1), media(2)]),
    });
    const gallery = screen.getByRole("region", { name: "Fotografie" });
    expect(within(gallery).getByLabelText("PIN z oznámení")).toBeInTheDocument();
    expect(within(gallery).getByText(/Galerii uvidíte po zadání PINu/)).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("/media/");
    expect(container.innerHTML).not.toContain("Pár číslo");
    expect(container.querySelector("#galerie img")).toBeNull();
  });

  it("příznak odemčení bez citlivých údajů nic neodemkne", () => {
    renderSite(protectedContent(), "cs", { sensitiveUnlocked: true, sensitive: null });
    const gallery = screen.getByRole("region", { name: "Fotografie" });
    expect(within(gallery).getByLabelText("PIN z oznámení")).toBeInTheDocument();
  });

  it("odemčeno: fotografie z citlivé části v pořadí, formulář PINu zmizí", () => {
    const { container } = renderSite(protectedContent(), "cs", {
      sensitiveUnlocked: true,
      sensitive: secret([media(2), media(1)]),
    });
    const gallery = screen.getByRole("region", { name: "Fotografie" });
    expect(within(gallery).queryByLabelText("PIN z oznámení")).toBeNull();
    expect(
      [...container.querySelectorAll("#galerie img")].map((i) => i.getAttribute("alt")),
    ).toEqual(["Pár číslo 2", "Pár číslo 1"]);
  });

  it("veřejné fotografie vedle chráněného odkazu zůstávají vidět i zamčené", () => {
    const content = withGallery([media(1)], {
      link: {
        url: null,
        label: null,
        protected: true,
        card: null,
      },
    });
    const { container } = renderSite(content);
    expect(container.querySelectorAll("#galerie img")).toHaveLength(1);
    const gallery = screen.getByRole("region", { name: "Fotografie" });
    expect(within(gallery).getByLabelText("PIN z oznámení")).toBeInTheDocument();
  });
});

describe("obrázek karty externí galerie", () => {
  const card = (imageMediaId: string | null) => ({
    url: "https://fotky.example/galerie",
    label: null,
    protected: false,
    card: {
      title: "Galerie Anny",
      description: "Fotky ze svatby",
      imageUrl: "https://cdn.example/cover.jpg",
      fetchedAt: "2026-10-02T08:00:00.000Z",
      imageMediaId,
      status: "ok" as const,
    },
  });

  it("vykreslí kopii z vlastního úložiště jako dekorativní obrázek, cizí adresa se nikde neobjeví", () => {
    const image = media(9, { alt: null, decorative: true, widths: [640, 1280] });
    const chateau: PublicContent = {
      ...eukalyptusFixture,
      template: "chateau",
      palette: "champagne",
    };
    const { container } = renderSite(
      withGallery([image], { mediaIds: [], link: card(ID(9)) }, chateau),
    );
    const link = screen.getByRole("link", { name: /Galerie Anny/ });
    const img = link.querySelector("img")!;
    expect(img).toHaveAttribute("alt", "");
    expect(img.getAttribute("src")).toBe(`/media/${ID(9)}/1280?f=webp`);
    expect(link.querySelector("source")?.getAttribute("srcset")).toContain(
      `/media/${ID(9)}/640?f=avif`,
    );
    expect(container.innerHTML).not.toContain("cdn.example");
    // název odkazu zůstává textem: obrázek ho nenahrazuje
    expect(link).toHaveTextContent("Galerie Anny");
  });

  it("Eukalyptus ukáže odkaz typograficky (doména, bez obrázku karty) a s textem o jiném webu", () => {
    const image = media(9, { alt: null, decorative: true, widths: [640, 1280] });
    renderSite(withGallery([image], { mediaIds: [], link: card(ID(9)) }));
    const link = screen.getByRole("link", { name: /Galerie Anny/ });
    expect(link.querySelector("img")).toBeNull();
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveTextContent("Odkaz se otevře na jiném webu");
  });

  it("bez kopie (úložiště není nastavené) zůstane karta bez obrázku", () => {
    renderSite(withGallery([], { mediaIds: [], link: card(null) }));
    expect(screen.getByRole("link", { name: /Galerie Anny/ }).querySelector("img")).toBeNull();
  });

  it("smazaná kopie (není v seznamu médií) se tiše vynechá", () => {
    renderSite(withGallery([], { mediaIds: [], link: card(ID(9)) }));
    expect(screen.getByRole("link", { name: /Galerie Anny/ }).querySelector("img")).toBeNull();
  });
});
