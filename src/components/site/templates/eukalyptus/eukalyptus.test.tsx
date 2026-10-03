// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getTranslator } from "@/i18n/load";
import { eukalyptusFixture, sensitiveFixture } from "@/site/fixtures/klara-a-matej";
import type { PublicContent } from "@/site/types";
import { SITE_NAMESPACES } from "../../context";
import { SiteRenderer } from "../../site-renderer";
import { EuStickyCta } from "./client";

const cs = await getTranslator("cs", SITE_NAMESPACES);
const NOW = new Date("2026-10-02T10:00:00+02:00");

function renderEu(content: PublicContent = eukalyptusFixture, now = NOW) {
  return render(<SiteRenderer content={content} t={cs} now={now} sensitive={sensitiveFixture} />);
}

/** Obsah s jinou fází a volitelně jen s některými bloky. */
function variant(patch: Partial<PublicContent>, keep?: string[]): PublicContent {
  return {
    ...eukalyptusFixture,
    ...patch,
    blocks: eukalyptusFixture.blocks.map((block) =>
      keep && block.type !== "hero" ? { ...block, enabled: keep.includes(block.type) } : block,
    ),
  };
}

describe("české skloňování odpočtu (zadání 8.2)", () => {
  it.each([
    [1, "Do svatby zbývá", "den"],
    [2, "Do svatby zbývají", "dny"],
    [4, "Do svatby zbývají", "dny"],
    [5, "Do svatby zbývá", "dní"],
    [11, "Do svatby zbývá", "dní"],
    [21, "Do svatby zbývá", "dní"],
    [22, "Do svatby zbývá", "dní"],
    [189, "Do svatby zbývá", "dní"],
  ] as const)("%i: %s %i %s", (count, label, unit) => {
    expect(cs("site.countdown.label", { count })).toBe(label);
    expect(cs("site.countdown.unit", { count })).toBe(unit);
  });

  it("v den svatby (0) místo čísla „Svatba je dnes“", () => {
    renderEu(eukalyptusFixture, new Date("2027-06-19T09:00:00+02:00"));
    const band = screen.getByRole("region", { name: "Svatba je dnes" });
    expect(band.querySelector(".eu-count")).toBeNull();
  });
});

describe("Eukalyptus: kompozice", () => {
  it("žádné dvě sousední sekce (včetně patičky) nemají stejnou plochu", () => {
    for (const keep of [undefined, ["venue", "rsvp"], ["gifts", "gallery"], ["program"], []]) {
      const { container, unmount } = renderEu(variant({}, keep));
      const tones = [...container.querySelectorAll("main > section, footer")].map((el) =>
        el.getAttribute("data-tone"),
      );
      expect(tones[0]).toBe("light");
      expect(tones.at(-1)).toBe("accent");
      for (let i = 1; i < tones.length; i++) expect(tones[i]).not.toBe(tones[i - 1]);
      unmount();
    }
  });

  it("sekce se číslují římsky podle vykreslených bloků", () => {
    const { container } = renderEu(variant({}, ["program", "venue", "rsvp"]));
    const labels = [...container.querySelectorAll(".eu-head .eu-label")].map(
      (el) => el.textContent?.split(" — ")[0],
    );
    expect(labels).toEqual(["I", "II", "III"]);
  });

  it("po svatbě: poděkování, fotografie hned za úvodem, bez odpočtu, RSVP a darů", () => {
    const { container } = renderEu(variant({ phase: "thanks" }));
    expect(screen.getByText("Děkujeme, že jste byli s námi")).toBeInTheDocument();
    const ids = [...container.querySelectorAll("main > section")].map((s) => s.id);
    expect(ids[1]).toBe("galerie");
    expect(ids).not.toContain("odpocet");
    expect(ids).not.toContain("potvrdit-ucast");
    expect(ids).not.toContain("dary");
  });

  it("úvod bez fotky má papírovou texturu, s fotkou fotku s popiskem a závoj", () => {
    const { container, unmount } = renderEu();
    expect(container.querySelector(".eu-hero")).toHaveClass("eu-paper");
    expect(container.querySelector(".eu-hero img")).toBeNull();
    unmount();
    const photoId = eukalyptusFixture.media[0].id;
    const withPhoto = {
      ...eukalyptusFixture,
      blocks: eukalyptusFixture.blocks.map((b) =>
        b.type === "hero" ? { ...b, data: { ...b.data, photoMediaId: photoId } } : b,
      ),
    };
    const photo = renderEu(withPhoto);
    const hero = photo.container.querySelector(".eu-hero")!;
    expect(hero).toHaveAttribute("data-photo", "true");
    // popisek prochází typo() (nezlomitelná mezera za „s“)
    expect(
      within(hero as HTMLElement)
        .getByRole("img")
        .getAttribute("alt"),
    ).toMatch(/^Ilustrace zahrady s\seukalyptovými větvemi$/u);
    expect(hero.querySelector("img")).toHaveAttribute("loading", "eager");
  });

  it("jména se nikdy neskloňují a „&“ zůstane s druhým jménem", () => {
    renderEu();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Klára & Matěj");
  });

  it("dekorace a vodoznak jsou skryté před čtečkami", () => {
    const { container } = renderEu();
    for (const el of container.querySelectorAll(
      ".eu-sprig, .eu-wreath, .eu-watermark, .eu-footer-giant",
    )) {
      expect(el.getAttribute("aria-hidden")).toBe("true");
    }
  });
});

describe("EuStickyCta", () => {
  it("při psaní do pole se schová i pro klávesnici a čtečky", () => {
    render(
      <>
        <section id="rsvp">
          <input aria-label="Jméno" />
        </section>
        <EuStickyCta target="rsvp" label="Potvrdit účast" regionLabel="Rychlý odkaz" />
      </>,
    );
    const link = screen.getByRole("link", { name: "Potvrdit účast" });
    expect(link).not.toHaveAttribute("tabindex");
    act(() => screen.getByLabelText("Jméno").focus());
    expect(link.closest("aside")).toHaveAttribute("aria-hidden", "true");
    expect(link).toHaveAttribute("tabindex", "-1");
  });
});
