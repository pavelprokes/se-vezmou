// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// Server Actions (databáze, cookie) se v komponentových testech nahrazují; chování ověřují testy služeb a e2e.
const actions = vi.hoisted(() => ({
  unlockAction: vi.fn(),
  matchAction: vi.fn(),
  unlistedAction: vi.fn(),
  submitAction: vi.fn(),
  resetAction: vi.fn(),
}));
vi.mock("./actions", () => actions);

import {
  editorialFixture,
  eukalyptusFixture,
  sensitiveFixture,
} from "@/site/fixtures/klara-a-matej";
import { templateKeys, templates } from "@/site/themes/palettes";
import type { Phase, PublicContent } from "@/site/types";
import { locales, type Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { SITE_NAMESPACES, type SiteTranslator } from "./context";
import { SiteRenderer } from "./site-renderer";

const NOW = new Date("2026-10-02T10:00:00+02:00");

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

function withPhase(phase: Phase, content = eukalyptusFixture): PublicContent {
  return { ...content, phase };
}

describe("SiteRenderer: bloky a struktura", () => {
  it("vykreslí jména jako jediný h1, datum, místo a odpočet", () => {
    renderSite(eukalyptusFixture);
    const h1 = screen.getAllByRole("heading", { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent("Klára & Matěj");
    expect(screen.getAllByText(/19.\s?června 2027/, { selector: "time" }).length).toBeGreaterThan(
      0,
    );
    // 2. 10. 2026 -> 19. 6. 2027 je 260 dní.
    expect(screen.getByText(/Do svatby zbývá 260\s+dní/)).toBeInTheDocument();
  });

  it("vykreslí všechny bloky Eukalyptu v pořadí position a každá kotva v navigaci existuje", () => {
    const { container } = renderSite(eukalyptusFixture);
    const sections = [...container.querySelectorAll("main > section")].map((s) => s.id);
    expect(sections).toEqual([
      "uvod",
      "pribeh",
      "program",
      "misto",
      "ubytovani",
      "dresscode",
      "otazky",
      "dary",
      "galerie",
      "kontakt",
      "potvrdit-ucast",
    ]);
    const nav = screen.getByRole("navigation", { name: "Navigace po stránce" });
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(sections.slice(1).map((id) => `#${id}`));
    for (const href of hrefs) expect(container.querySelector(href!)).not.toBeNull();
  });

  it("každá sekce je pojmenovaná nadpisem druhé úrovně", () => {
    const { container } = renderSite(eukalyptusFixture);
    for (const section of container.querySelectorAll("main > section:not(#uvod)")) {
      const label = section.getAttribute("aria-labelledby")!;
      expect(section.querySelector(`h2#${label}`)).not.toBeNull();
    }
  });

  it("program je seřazený podle času a ukazuje čas a místo", () => {
    renderSite(eukalyptusFixture);
    const program = screen.getByRole("region", { name: "Program" });
    const items = within(program).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector("time")?.textContent)).toEqual([
      "14:00",
      "15:00",
      "17:30",
      "20:00",
    ]);
    expect(items[0]).toHaveTextContent("Svatební obřad");
    // Místo bez předložky a bez skloňování, tak jak ho pár zadal.
    expect(items[0]).toHaveTextContent("Zámecká kaple");
    expect(items[0]).not.toHaveTextContent("v Zámecká kaple");
  });

  it("místo má vždy textovou adresu a mapu jen jako odkaz, bez vložení třetích stran", () => {
    const { container } = renderSite(eukalyptusFixture);
    const venue = screen.getByRole("region", { name: "Místo konání" });
    expect(within(venue).getAllByText("Zámecká 1, 252 01 Dobřichovice")).toHaveLength(2);
    const map = within(venue).getByRole("link", { name: /Zobrazit na mapě/ });
    expect(map).toHaveAttribute("href", expect.stringMatching(/^https:\/\//));
    expect(map).toHaveAttribute("rel", "noopener noreferrer");
    expect(container.querySelector("iframe, script, embed, object")).toBeNull();
    // Druhé místo nemá mapu, adresa je přesto vidět.
    expect(within(venue).getAllByRole("link", { name: /mapě/ })).toHaveLength(1);
  });

  it("mapa místa: dlaždice z vlastního původu, jen veřejná místa, odkazy do Google Maps a Mapy.cz", () => {
    const { container } = renderSite(eukalyptusFixture);
    const venue = screen.getByRole("region", { name: "Místo konání" });
    const map = within(venue).getByRole("img", { name: /^Mapa místa konání/ });
    expect(map.getAttribute("aria-label")).toContain("Zámecká kaple");
    expect(map.getAttribute("aria-label")).not.toContain("Soukromý altán");
    const tiles = [...container.querySelectorAll(".site-map img")];
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles)
      expect(tile.getAttribute("src")).toMatch(/^\/api\/map-tile\/\d+\/\d+\/\d+$/);
    for (const name of ["Google Maps", "Mapy.cz"]) {
      const links = within(venue).getAllByRole("link", { name: new RegExp(name) });
      // dvě veřejná místa se souřadnicemi, soukromé odkazy nemá
      expect(links).toHaveLength(2);
      for (const link of links) {
        expect(link).toHaveAttribute("href", expect.stringMatching(/^https:\/\//));
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
      }
    }
    expect(within(venue).getByRole("link", { name: /OpenStreetMap/ })).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/copyright",
    );
  });

  it("bez volby mapy nebo bez souřadnic se mapa ani odkazy nevykreslí", () => {
    const { container, unmount } = renderSite(editorialFixture);
    expect(container.querySelector(".site-map")).toBeNull();
    expect(screen.queryByRole("link", { name: /Google Maps/ })).toBeNull();
    unmount();
    const noCoords = structuredClone(eukalyptusFixture);
    for (const venue of noCoords.venues) Object.assign(venue, { lat: null, lng: null });
    const second = renderSite(noCoords);
    expect(second.container.querySelector(".site-map")).toBeNull();
  });

  it("FAQ je přístupné: nativní details a summary, bez vlastního skriptu", () => {
    const { container } = renderSite(eukalyptusFixture);
    const faq = screen.getByRole("region", { name: "Časté otázky" });
    const items = faq.querySelectorAll("details");
    expect(items).toHaveLength(3);
    for (const details of items) {
      // `summary` je první potomek `details`, je v pořadí zaměření a nic není rozbalené předem.
      expect(details.firstElementChild?.tagName).toBe("SUMMARY");
      expect(details.open).toBe(false);
      expect(details.firstElementChild?.getAttribute("tabindex")).toBeNull();
    }
    expect(container.querySelector("[onclick], [role='button']")).toBeNull();
    // Ovládání klávesnicí (Enter, mezerník) ověřují e2e testy v prohlížeči.
  });

  it("kontakty jsou odkazy mailto a tel", () => {
    renderSite(eukalyptusFixture);
    const contact = screen.getByRole("region", { name: "Kontakt" });
    expect(within(contact).getByRole("link", { name: /eva@example.com/ })).toHaveAttribute(
      "href",
      "mailto:eva@example.com",
    );
    expect(within(contact).getByRole("link", { name: /777 000 111/ })).toHaveAttribute(
      "href",
      "tel:+420777000111",
    );
  });

  it("galerie: obrázek má alt, dekorativní má prázdný alt", () => {
    renderSite(eukalyptusFixture);
    const gallery = screen.getByRole("region", { name: "Fotografie" });
    const images = gallery.querySelectorAll("img");
    expect([...images].map((i) => i.getAttribute("alt")?.replace(/\u00a0/g, " "))).toEqual([
      "Ilustrace zahrady s eukalyptovými větvemi",
      "Ilustrace zámku při západu slunce",
      "",
    ]);
  });

  it("obrázek bez popisku, který není dekorativní, se nevykreslí", () => {
    const broken: PublicContent = {
      ...eukalyptusFixture,
      media: eukalyptusFixture.media.map((m) =>
        m.id === "m2" ? { ...m, alt: null, decorative: false } : m,
      ),
    };
    renderSite(broken);
    const images = [...document.querySelectorAll("#galerie img")];
    expect(images).toHaveLength(2);
  });

  it("vypnuté a prázdné bloky se nevykreslí ani v navigaci", () => {
    const content: PublicContent = {
      ...eukalyptusFixture,
      blocks: eukalyptusFixture.blocks.map((b) =>
        b.type === "faq"
          ? { ...b, enabled: false }
          : b.type === "gallery"
            ? { ...b, data: { mediaIds: [], photosProtected: false, link: null } }
            : b,
      ),
    };
    const { container } = renderSite(content);
    expect(container.querySelector("#otazky")).toBeNull();
    expect(container.querySelector("#galerie")).toBeNull();
    expect(container.querySelector('a[href="#otazky"]')).toBeNull();
    expect(container.querySelector('a[href="#galerie"]')).toBeNull();
  });

  it("bez úvodního bloku má stránka přesto h1 s jmény", () => {
    renderSite({
      ...eukalyptusFixture,
      blocks: eukalyptusFixture.blocks.filter((b) => b.type !== "hero"),
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Klára & Matěj");
  });

  it("odpočet je volitelný", () => {
    renderSite({
      ...eukalyptusFixture,
      blocks: eukalyptusFixture.blocks.map((b) =>
        b.type === "hero" ? { ...b, data: { ...b.data, countdown: false } } : b,
      ),
    });
    expect(screen.queryByText(/Do svatby zbývá/)).toBeNull();
  });
});

describe("SiteRenderer: jazyk a náhradní jazyk", () => {
  it("anglická verze používá anglické texty a popisky", () => {
    renderSite(eukalyptusFixture, "en");
    expect(screen.getByRole("region", { name: "Programme" })).toBeInTheDocument();
    expect(screen.getByText("Wedding ceremony")).toBeInTheDocument();
    expect(screen.getByText(/260 days to go/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "RSVP" })).toHaveLength(2); // navigace a ukotvené tlačítko
  });

  it("chybějící překlad ukáže dostupný jazyk a označí ho atributem lang", () => {
    renderSite(editorialFixture, "en");
    // Úvod programu je jen česky.
    const intro = screen.getByText("Den začíná před polednem a končí po půlnoci.");
    expect(intro).toHaveAttribute("lang", "cs");
    // Přeložený text nemá zbytečný lang.
    expect(screen.getByText("You are invited to our wedding")).not.toHaveAttribute("lang");
    // Odpověď FAQ je jen česky, otázka přeložená.
    expect(screen.getByText("Can I bring children?")).toBeInTheDocument();
    expect(screen.getByText("Samozřejmě, děti jsou vítány.").closest("[lang]")).toHaveAttribute(
      "lang",
      "cs",
    );
  });

  it("nikdy nezobrazí klíč ani prázdnou položku", () => {
    const { container } = renderSite(editorialFixture, "en");
    expect(container.textContent).not.toMatch(/\bsite\.[a-z]+\.[a-zA-Z]+/);
    expect(container.textContent).not.toContain("undefined");
    for (const heading of container.querySelectorAll("h1, h2, h3")) {
      expect(heading.textContent?.trim()).not.toBe("");
    }
  });

  it("přepínač jazyka nabízí jen jazyky webu a označí aktuální", () => {
    const { rerender } = renderSite(eukalyptusFixture);
    const lang = screen.getByRole("navigation", { name: "Jazyk" });
    const links = within(lang).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("hreflang"))).toEqual(["cs", "en"]);
    expect(links[0]).toHaveAttribute("aria-current", "true");
    expect(links[1]).not.toHaveAttribute("aria-current");

    rerender(
      <SiteRenderer
        content={{ ...eukalyptusFixture, locales: ["cs"] }}
        t={translators.cs}
        now={NOW}
      />,
    );
    expect(screen.queryByRole("navigation", { name: "Jazyk" })).toBeNull();
  });
});

describe("SiteRenderer: rychlá změna", () => {
  it("zobrazí pruh s oznámením, když je zapnutá", () => {
    renderSite(eukalyptusFixture);
    const notice = screen.getByRole("complementary", { name: "Důležité oznámení" });
    expect(notice).toHaveTextContent("Obřad začíná v 14:00");
  });

  it("bez rychlé změny pruh není", () => {
    renderSite({ ...eukalyptusFixture, quickNotice: null });
    expect(screen.queryByRole("complementary", { name: "Důležité oznámení" })).toBeNull();
  });
});

describe("SiteRenderer: ukotvené tlačítko Potvrdit účast", () => {
  it("je odkaz na kotvu sekce a je jen při otevřeném potvrzování", () => {
    renderSite(eukalyptusFixture);
    const bar = screen.getByRole("complementary", { name: "Rychlý odkaz na potvrzení účasti" });
    expect(within(bar).getByRole("link", { name: "Potvrdit účast" })).toHaveAttribute(
      "href",
      "#potvrdit-ucast",
    );
  });

  it.each(["save_the_date", "rsvp_closed", "wedding_day", "thanks"] as const)(
    "ve fázi %s tlačítko není",
    (phase) => {
      renderSite(withPhase(phase));
      expect(
        screen.queryByRole("complementary", { name: "Rychlý odkaz na potvrzení účasti" }),
      ).toBeNull();
    },
  );

  it("sekce Potvrdit účast hlásí, že potvrzování je uzavřeno nebo se teprve otevře", () => {
    const { unmount } = renderSite(withPhase("rsvp_closed"));
    expect(screen.getByText("Potvrzení účasti je již uzavřeno.")).toBeInTheDocument();
    unmount();
    renderSite(withPhase("save_the_date"));
    expect(screen.getByText("Potvrzení účasti se otevře později.")).toBeInTheDocument();
  });
});

describe("SiteRenderer: režim poděkování po svatbě (FR-WEB-4)", () => {
  const thanks = () => withPhase("thanks");

  it("odpočet a potvrzení účasti zmizí, místo úvodu je poděkování", () => {
    const { container } = renderSite(thanks());
    expect(screen.queryByText(/Do svatby zbývá/)).toBeNull();
    expect(container.querySelector("#potvrdit-ucast")).toBeNull();
    expect(container.querySelector('a[href="#potvrdit-ucast"]')).toBeNull();
    expect(screen.queryByRole("link", { name: "Potvrdit účast" })).toBeNull();
    expect(screen.getAllByText("Děkujeme, že jste byli s námi").length).toBeGreaterThan(0);
  });

  it("dary se skryjí úplně, i odemčené, včetně zástupného formuláře PINu", () => {
    const { container } = renderSite(thanks(), "cs", {
      sensitiveUnlocked: true,
      sensitive: sensitiveFixture,
    });
    expect(container.querySelector("#dary")).toBeNull();
    expect(container.textContent).not.toContain(sensitiveFixture.gifts!.account);
    expect(screen.queryByLabelText("PIN z pozvánky")).toBeNull();
  });

  it("galerie zůstane", () => {
    const { container } = renderSite(thanks());
    expect(container.querySelector("#galerie")).not.toBeNull();
    expect(container.querySelectorAll("#galerie img").length).toBe(3);
  });

  it("vlastní poděkování páru nahradí výchozí text", () => {
    renderSite({
      ...thanks(),
      thanksMessage: { cs: "Díky všem za nezapomenutelný den.", en: "Thanks for a wonderful day." },
    });
    expect(screen.getByText("Díky všem za nezapomenutelný den.")).toBeInTheDocument();
    expect(screen.queryByText(/Váš čas a radost/)).toBeNull();
  });
});

describe("SiteRenderer: odkaz na externí fotogalerii", () => {
  type GalleryLink = Extract<PublicContent["blocks"][number], { type: "gallery" }>["data"]["link"];

  function withLink(link: GalleryLink, content = eukalyptusFixture): PublicContent {
    return {
      ...content,
      blocks: content.blocks.map((b) =>
        b.type === "gallery" ? { ...b, data: { ...b.data, link } } : b,
      ),
    };
  }

  const publicLink: GalleryLink = {
    url: "https://fotky.example/svatba",
    label: { cs: "Fotky od Anny", en: "Photos by Anna" },
    protected: false,
    card: {
      title: "Svatba Kláry a Matěje",
      description: "Fotky z obřadu a hostiny",
      imageUrl: "https://fotky.example/og.jpg",
      fetchedAt: "2026-10-02T08:00:00.000Z",
      imageMediaId: null,
      status: "ok",
    },
  };

  it("karta je jediný odkaz s názvem, popisem, doménou a upozorněním, že se otevře jinde", () => {
    const { container } = renderSite(withLink(publicLink));
    const link = screen.getByRole("link", { name: /Fotky od Anny/ });
    expect(link).toHaveAttribute("href", "https://fotky.example/svatba");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link).toHaveTextContent("Fotky z obřadu a hostiny");
    expect(link).toHaveTextContent("fotky.example");
    expect(link).toHaveTextContent("Odkaz se otevře na jiném webu");
    // Název od páru přepisuje název z cílové stránky.
    expect(container.textContent).not.toContain("Svatba Kláry a Matěje");
  });

  it("bez názvu od páru se použije název z cílové stránky, bez karty výchozí text a doména", () => {
    renderSite(withLink({ ...publicLink, label: null }));
    expect(screen.getByRole("link", { name: /Svatba Kláry a Matěje/ })).toBeInTheDocument();
    document.body.innerHTML = "";
    renderSite(withLink({ ...publicLink, label: null, card: null }));
    const link = screen.getByRole("link", { name: /Zobrazit všechny fotografie/ });
    expect(link).toHaveTextContent("fotky.example");
    document.body.innerHTML = "";
    renderSite(
      withLink({
        ...publicLink,
        label: null,
        card: {
          title: null,
          description: null,
          imageUrl: null,
          fetchedAt: null,
          imageMediaId: null,
          status: "failed",
        },
      }),
    );
    expect(screen.getByRole("link", { name: /Zobrazit všechny fotografie/ })).toBeInTheDocument();
  });

  it("obrázek z cílové stránky se nevykreslí a web nenačítá nic z cizího původu", () => {
    const { container } = renderSite(withLink(publicLink));
    expect(container.innerHTML).not.toContain("og.jpg");
    const sources = [...container.querySelectorAll("[src], link[href], script[src], iframe")]
      .map((el) => el.getAttribute("src") ?? el.getAttribute("href") ?? "")
      .filter((value) => /^https?:\/\//.test(value));
    expect(sources).toEqual([]);
  });

  it("titulek a popis jsou jen text: značky se nevykreslí", () => {
    const { container } = renderSite(
      withLink({
        ...publicLink,
        label: null,
        card: {
          ...publicLink.card!,
          title: "<img src=x onerror=alert(1)>",
          description: "<script>alert(1)</script>",
        },
      }),
    );
    expect(container.querySelector("#galerie script")).toBeNull();
    expect(container.querySelector("#galerie img[onerror]")).toBeNull();
    expect(container.querySelector("#galerie")?.textContent).toContain(
      "<img src=x onerror=alert(1)>",
    );
  });

  it("anglická verze má anglický text odkazu a upozornění", () => {
    renderSite(withLink(publicLink), "en");
    const link = screen.getByRole("link", { name: /Photos by Anna/ });
    expect(link).toHaveTextContent("Link opens on another website");
  });

  it("zůstává i v režimu poděkování po svatbě", () => {
    const content = withLink(publicLink, { ...eukalyptusFixture, phase: "thanks" as const });
    renderSite(content);
    expect(screen.getByRole("link", { name: /Fotky od Anny/ })).toBeInTheDocument();
  });

  it("galerie jen s odkazem (bez fotek) se vykreslí a je v navigaci", () => {
    const content: PublicContent = {
      ...eukalyptusFixture,
      media: [],
      blocks: eukalyptusFixture.blocks.map((b) =>
        b.type === "gallery"
          ? { ...b, data: { mediaIds: [], photosProtected: false, link: publicLink } }
          : b,
      ),
    };
    const { container } = renderSite(content);
    expect(container.querySelector("#galerie")).not.toBeNull();
    expect(screen.getByRole("link", { name: /Fotky od Anny/ })).toBeInTheDocument();
  });

  describe("chráněný odkaz (jen po PINu hostů)", () => {
    const protectedLink: GalleryLink = {
      url: null,
      label: { cs: "Tajná galerie" },
      protected: true,
      card: null,
    };
    const secret = {
      ...sensitiveFixture,
      gallery: {
        url: "https://fotky.example/tajne-abc123",
        card: {
          title: "Soukromé fotky",
          description: "Jen pro hosty",
          imageUrl: null,
          fetchedAt: null,
          imageMediaId: null,
          status: "ok" as const,
        },
      },
    };

    it("zamčeno: v HTML není adresa, titulek ani popis, jen formulář PINu", () => {
      const { container } = renderSite(withLink(protectedLink), "cs", { sensitive: secret });
      const gallery = screen.getByRole("region", { name: "Fotografie" });
      expect(within(gallery).getByLabelText("PIN z pozvánky")).toBeInTheDocument();
      expect(container.innerHTML).not.toContain("tajne-abc123");
      expect(container.innerHTML).not.toContain("Soukromé fotky");
      expect(container.innerHTML).not.toContain("Jen pro hosty");
      expect(within(gallery).queryByRole("link", { name: /Tajná galerie/ })).toBeNull();
    });

    it("příznak bez citlivých údajů nic neodemkne", () => {
      const { container } = renderSite(withLink(protectedLink), "cs", {
        sensitiveUnlocked: true,
        sensitive: null,
      });
      expect(container.innerHTML).not.toContain("tajne-abc123");
      const gallery = screen.getByRole("region", { name: "Fotografie" });
      expect(within(gallery).getByLabelText("PIN z pozvánky")).toBeInTheDocument();
    });

    it("odemčeno: odkaz s kartou je vidět, formulář PINu zmizí", () => {
      renderSite(withLink(protectedLink), "cs", { sensitiveUnlocked: true, sensitive: secret });
      const link = screen.getByRole("link", { name: /Tajná galerie/ });
      expect(link).toHaveAttribute("href", "https://fotky.example/tajne-abc123");
      expect(link).toHaveTextContent("Jen pro hosty");
      expect(screen.queryByLabelText("PIN z pozvánky")).toBeNull();
    });
  });
});

describe("SiteRenderer: dary za PINem (FR-PRIV-2)", () => {
  it("bez příznaku sensitiveUnlocked je vidět jen formulář PINu, žádný údaj o účtu", () => {
    const { container } = renderSite(eukalyptusFixture, "cs", { sensitive: sensitiveFixture });
    const gifts = screen.getByRole("region", { name: "Dary" });
    expect(within(gifts).getByRole("form", { name: /chráněna PINem/ })).toBeInTheDocument();
    expect(within(gifts).getByLabelText("PIN z pozvánky")).toBeInTheDocument();
    expect(container.textContent).not.toContain(sensitiveFixture.gifts!.account);
    expect(container.textContent).not.toContain("Klára Ukázková");
    expect(container.querySelector("svg.site-qr")).toBeNull();
    // Úvodní text darů je za PINem také.
    expect(container.textContent).not.toContain("Největší radost nám uděláte");
  });

  it("příznak bez citlivých údajů nic neodemkne", () => {
    renderSite(eukalyptusFixture, "cs", { sensitiveUnlocked: true, sensitive: null });
    const gifts = screen.getByRole("region", { name: "Dary" });
    expect(within(gifts).getByLabelText("PIN z pozvánky")).toBeInTheDocument();
  });

  it("s příznakem vykreslí číslo účtu a QR platbu s popiskem", () => {
    const { container } = renderSite(eukalyptusFixture, "cs", {
      sensitiveUnlocked: true,
      sensitive: sensitiveFixture,
    });
    const gifts = screen.getByRole("region", { name: "Dary" });
    expect(within(gifts).getByText("19-2000145399/0800")).toBeInTheDocument();
    expect(within(gifts).queryByLabelText("PIN z pozvánky")).toBeNull();
    const qr = within(gifts).getByRole("img", { name: /QR kód pro platbu na účet/ });
    expect(qr.tagName.toLowerCase()).toBe("svg");
    expect(container.querySelector("svg.site-qr path")?.getAttribute("d")?.length).toBeGreaterThan(
      200,
    );
    expect(
      within(gifts).getByText("Částku si zvolíte sami v bankovní aplikaci."),
    ).toBeInTheDocument();
  });

  it("chybný PIN: chyba slovy v živé oblasti, pole označené a zaměřené, nic se neodemkne", async () => {
    actions.unlockAction.mockResolvedValue({ error: "invalid" });
    const user = userEvent.setup();
    renderSite(eukalyptusFixture);
    const gifts = screen.getByRole("region", { name: "Dary" });
    const input = within(gifts).getByLabelText("PIN z pozvánky");
    await user.type(input, "123 456");
    await user.click(within(gifts).getByRole("button", { name: "Odemknout" }));
    expect(await within(gifts).findByText(/PIN nesouhlasí/)).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveFocus();
    expect(within(gifts).getByRole("alert")).toHaveTextContent("PIN nesouhlasí");
    // formulář odeslal zadaný PIN i jazyk; hodnotu PINu čte server, ne klient
    const formData = actions.unlockAction.mock.calls[0][1] as FormData;
    expect(formData.get("pin")).toBe("123 456");
    expect(formData.get("locale")).toBe("cs");
  });

  it("pauza po chybách se ukáže slovy s délkou pauzy", async () => {
    actions.unlockAction.mockResolvedValue({ error: "locked", pause: "15 minut" });
    const user = userEvent.setup();
    renderSite(eukalyptusFixture);
    const gifts = screen.getByRole("region", { name: "Dary" });
    await user.type(within(gifts).getByLabelText("PIN z pozvánky"), "999999");
    await user.click(within(gifts).getByRole("button", { name: "Odemknout" }));
    expect(
      await within(gifts).findByText(/pozastaveno\. Zkuste to znovu za 15 minut/),
    ).toBeInTheDocument();
  });

  it("pole PINu je heslové, číselné a bez automatického doplnění", () => {
    renderSite(eukalyptusFixture);
    const gifts = screen.getByRole("region", { name: "Dary" });
    const input = within(gifts).getByLabelText("PIN z pozvánky");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)).toHaveTextContent(
      "PIN najdete na pozvánce",
    );
  });
});

describe("SiteRenderer: soukromé místo za PINem (FR-PRIV-2)", () => {
  it("bez PINu je vidět název a formulář, adresa ani popis cesty nejsou nikde", () => {
    const { container } = renderSite(eukalyptusFixture, "cs", { sensitive: sensitiveFixture });
    const card = screen.getByRole("article", { name: "Soukromý altán" });
    expect(within(card).getByLabelText("PIN z pozvánky")).toBeInTheDocument();
    expect(container.textContent).not.toContain("Altánová 7");
    expect(container.textContent).not.toContain("zelené značce");
  });

  it("s PINem ukáže adresu a popis cesty soukromého místa", () => {
    renderSite(eukalyptusFixture, "cs", { sensitiveUnlocked: true, sensitive: sensitiveFixture });
    const card = screen.getByRole("article", { name: "Soukromý altán" });
    expect(within(card).getByText("Altánová 7, 252 01 Dobřichovice")).toBeInTheDocument();
    expect(within(card).getByText(/zelené značce/)).toBeInTheDocument();
    expect(within(card).queryByLabelText("PIN z pozvánky")).toBeNull();
  });
});

describe("SiteRenderer: čtyři šablony nad společnými bloky", () => {
  for (const template of templateKeys) {
    for (const palette of templates[template].palettes) {
      it(`${template} / ${palette.key}: stejné bloky, jen jiné tokeny`, () => {
        const content: PublicContent = { ...eukalyptusFixture, template, palette: palette.key };
        const { container } = renderSite(content, "en", {
          sensitiveUnlocked: true,
          sensitive: sensitiveFixture,
        });
        const root = container.querySelector(".site-root") as HTMLElement;
        expect(root.dataset.template).toBe(template);
        expect(root.dataset.palette).toBe(palette.key);
        expect(root.style.getPropertyValue("--s-bg").toLowerCase()).toBe(
          palette.colors.bg.toLowerCase(),
        );
        expect(root.style.getPropertyValue("--s-text").toLowerCase()).toBe(
          palette.colors.text.toLowerCase(),
        );
        expect(container.querySelectorAll("main > section")).toHaveLength(11);
        // Dekorativní SVG šablony jsou skryté před čtečkami.
        for (const svg of container.querySelectorAll("svg:not([role='img'])")) {
          expect(svg.getAttribute("aria-hidden")).toBe("true");
        }
      });
    }
  }

  it("neznámá paleta padá na výchozí paletu šablony", () => {
    const { container } = renderSite({ ...eukalyptusFixture, palette: "neexistuje" });
    expect((container.querySelector(".site-root") as HTMLElement).dataset.palette).toBe("bordo");
  });

  it("listy Eukalyptu a monogram Chateau jsou dekor (aria-hidden), ostatní šablony je nemají", () => {
    const eu = renderSite(eukalyptusFixture);
    expect(eu.container.querySelectorAll(".site-leaves[aria-hidden='true']")).toHaveLength(2);
    eu.unmount();
    const ch = renderSite({ ...eukalyptusFixture, template: "chateau", palette: "champagne" });
    const monogram = ch.container.querySelector(".site-monogram");
    expect(monogram?.getAttribute("aria-hidden")).toBe("true");
    expect(ch.container.querySelector(".site-leaves")).toBeNull();
    ch.unmount();
    const modern = renderSite({ ...eukalyptusFixture, template: "modern", palette: "slunce" });
    expect(modern.container.querySelector(".site-leaves, .site-monogram")).toBeNull();
  });
});
