// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { MediaActions } from "@/lib/media/action-types";
import type { MediaItem } from "@/lib/media/types";
import { AdminI18nProvider } from "./i18n";
import { pickAdminMessages } from "./messages";

const adminMessages = await pickAdminMessages("cs");
import { PhotosPanel, orderedPhotos } from "./photos";

/**
 * Panel fotografií v editoru (M7c): stavy (nedostupné úložiště, plno), popisek po jazycích s upozorněním,
 * dekorativní příznak, řazení tlačítky, potvrzené mazání a fronta nahrávání. Přístupnost celého editoru hlídá axe
 * v `e2e/photos.a11y.ts`, tady se ověřuje chování a to, co čtečka dostane.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function item(n: number, patch: Partial<MediaItem> = {}): MediaItem {
  return {
    id: ID(n),
    kind: "photo",
    status: "ready",
    failureCode: null,
    width: 1920,
    height: 1280,
    bytes: 1000,
    alt: null,
    decorative: false,
    widths: [640, 1280, 1920],
    ...patch,
  };
}

function actions(overrides: Partial<MediaActions> = {}): MediaActions {
  return {
    requestUpload: vi.fn(async () => ({
      status: "ok" as const,
      id: ID(900),
      url: "https://r2.example/put",
      headers: { "Content-Type": "image/jpeg" },
      expiresInSeconds: 600,
    })),
    renewUpload: vi.fn(async () => ({ status: "not_found" as const })),
    finishUpload: vi.fn(async () => ({ status: "ok" as const, item: item(900) })),
    update: vi.fn(async ({ id }) => ({ status: "ok" as const, item: item(Number(id.slice(-3))) })),
    remove: vi.fn(async () => ({ status: "ok" as const })),
    exportPhotos: vi.fn(async () => ({
      status: "ok" as const,
      files: [
        { name: "foto-01.webp", url: "https://r2.example/d1", bytes: 2_500_000, width: 1920 },
      ],
    })),
    ...overrides,
  };
}

function Harness({
  initial,
  mediaActions,
  available = true,
  spies = {},
}: {
  initial: MediaItem[];
  mediaActions: MediaActions;
  available?: boolean;
  spies?: {
    onReorder?: (ids: string[]) => void;
    onRemove?: (id: string) => void;
    onAdd?: (id: string) => void;
    onProtected?: (value: boolean) => void;
  };
}) {
  const [media, setMedia] = useState(initial);
  const [ids, setIds] = useState(initial.map((m) => m.id));
  const [protectedPhotos, setProtected] = useState(false);
  return (
    <AdminI18nProvider locale="cs" messages={adminMessages}>
      <PhotosPanel
        ids={ids}
        media={media}
        setMedia={setMedia}
        actions={mediaActions}
        available={available}
        locales={["cs", "en"]}
        onReorder={(next) => {
          spies.onReorder?.(next);
          setIds(next);
        }}
        onAdd={(id) => {
          spies.onAdd?.(id);
          setIds((current) => [...current, id]);
        }}
        onRemove={(id) => {
          spies.onRemove?.(id);
          setIds((current) => current.filter((x) => x !== id));
        }}
        photosProtected={protectedPhotos}
        onProtectedChange={(value) => {
          spies.onProtected?.(value);
          setProtected(value);
        }}
        guestPinReady={false}
      />
    </AdminI18nProvider>
  );
}

describe("orderedPhotos", () => {
  it("pořadí z dokumentu, potom fotografie, které v dokumentu ještě nejsou; karty nikdy", () => {
    const media = [item(1), item(2), item(3), item(4, { kind: "card" })];
    expect(orderedPhotos(media, [ID(3), ID(99), ID(1)]).map((m) => m.id)).toEqual([
      ID(3),
      ID(1),
      ID(2),
    ]);
  });
});

describe("PhotosPanel", () => {
  it("bez úložiště se nahrávání nenabízí a vysvětlí se proč", () => {
    render(<Harness initial={[]} mediaActions={actions()} available={false} />);
    expect(screen.queryByLabelText("Vybrat fotografie")).toBeNull();
    expect(screen.getByText(/úložiště není nastavené/)).toBeInTheDocument();
  });

  it("pole pro výběr souborů má viditelný popisek, nápovědu a accept jen na JPEG, PNG a WebP", () => {
    render(<Harness initial={[item(1)]} mediaActions={actions()} />);
    const input = screen.getByLabelText("Vybrat fotografie");
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(input).toHaveAttribute("multiple");
    expect(input).toHaveAccessibleDescription(/Zbývá místo pro 11 fotografií/);
    expect(screen.getByText(/až 12 vlastních fotografií/)).toBeInTheDocument();
  });

  it("při plném limitu je výběr vypnutý a říká proč", () => {
    const full = Array.from({ length: 12 }, (_, i) => item(i + 1));
    render(<Harness initial={full} mediaActions={actions()} />);
    expect(screen.getByLabelText("Vybrat fotografie")).toBeDisabled();
    expect(screen.getByText(/Máte nahraných 12 fotografií/)).toBeInTheDocument();
  });

  it("chybějící popisek je upozornění textem, dekorativní příznak ho zruší a uloží se hned", async () => {
    const mediaActions = actions();
    const user = userEvent.setup();
    render(<Harness initial={[item(1)]} mediaActions={mediaActions} />);
    const group = screen.getByRole("group", { name: /Fotografie 1\sz\s1/ });
    expect(within(group).getByText(/Chybí popisek: fotografie se nezveřejní/)).toBeInTheDocument();
    await user.click(within(group).getByLabelText("Dekorativní fotografie (bez popisku)"));
    expect(within(group).queryByText(/Chybí popisek/)).toBeNull();
    expect(within(group).getByText(/Čtečka obrazovky ji přeskočí/)).toBeInTheDocument();
    await waitFor(() =>
      expect(mediaActions.update).toHaveBeenCalledWith({ id: ID(1), alt: null, decorative: true }),
    );
    expect(await within(group).findByText("Popisek uložen.")).toBeInTheDocument();
  });

  it("popisek se ukládá s krátkým zpožděním, po jazycích; chybějící překlad se hlásí pod polem", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const mediaActions = actions();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<Harness initial={[item(1)]} mediaActions={mediaActions} />);
      const group = screen.getByRole("group", { name: /Fotografie 1\sz\s1/ });
      await user.type(within(group).getByLabelText("Čeština"), "Pár");
      // upozornění na překlad (stejné jako u ostatních textů) a žádné ukládání po každém úhozu
      expect(within(group).getByText(/Chybí překlad/)).toBeInTheDocument();
      expect(mediaActions.update).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(mediaActions.update).toHaveBeenCalledTimes(1);
      expect(mediaActions.update).toHaveBeenCalledWith({
        id: ID(1),
        alt: { cs: "Pár" },
        decorative: false,
      });
      expect(within(group).queryByText(/Chybí popisek/)).toBeNull();
      await user.type(within(group).getByLabelText("English"), "Couple");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(mediaActions.update).toHaveBeenLastCalledWith({
        id: ID(1),
        alt: { cs: "Pár", en: "Couple" },
        decorative: false,
      });
      expect(within(group).queryByText(/Chybí překlad/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("selhání uložení popisku se hlásí slovy", async () => {
    const mediaActions = actions({
      update: vi.fn(async () => ({ status: "error" as const })),
    });
    const user = userEvent.setup();
    render(<Harness initial={[item(1)]} mediaActions={mediaActions} />);
    const group = screen.getByRole("group", { name: /Fotografie 1\sz\s1/ });
    await user.click(within(group).getByLabelText("Dekorativní fotografie (bez popisku)"));
    expect(
      await within(group).findByText("Popisek se nepodařilo uložit. Zkuste to znovu."),
    ).toBeInTheDocument();
  });

  it("řazení tlačítky: krajní jsou vypnutá, pořadí a ohlášená pozice odpovídají, přetažení je jen doplněk", async () => {
    const onReorder = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness
        initial={[item(1), item(2), item(3)]}
        mediaActions={actions()}
        spies={{ onReorder }}
      />,
    );
    expect(screen.getByRole("button", { name: "Posunout fotografii 1 výš" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Posunout fotografii 3 níž" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Posunout fotografii 3 výš" }));
    expect(onReorder).toHaveBeenLastCalledWith([ID(1), ID(3), ID(2)]);
    expect(screen.getByText("Fotografie přesunuta na pozici 2 z 3.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Posunout fotografii 1 níž" }));
    expect(onReorder).toHaveBeenLastCalledWith([ID(3), ID(1), ID(2)]);
    expect(screen.getByText(/změníte přetažením, nebo tlačítky/)).toBeInTheDocument();
  });

  it("smazání se potvrzuje druhým krokem, Zrušit nic nesmaže; po smazání se oznámí a zmizí", async () => {
    const onRemove = vi.fn();
    const mediaActions = actions();
    const user = userEvent.setup();
    render(
      <Harness initial={[item(1), item(2)]} mediaActions={mediaActions} spies={{ onRemove }} />,
    );
    await user.click(screen.getByRole("button", { name: "Smazat fotografii 2" }));
    expect(screen.getByRole("group", { name: /Smazat fotografii 2 nadobro/ })).toBeInTheDocument();
    expect(screen.getByText(/Zmizí i z už zveřejněného webu/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Zrušit" }));
    expect(mediaActions.remove).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Smazat fotografii 2" }));
    await user.click(screen.getByRole("button", { name: "Ano, smazat" }));
    await waitFor(() => expect(mediaActions.remove).toHaveBeenCalledWith(ID(2)));
    expect(await screen.findByText("Fotografie smazána.")).toBeInTheDocument();
    expect(onRemove).toHaveBeenCalledWith(ID(2));
    expect(screen.queryByRole("group", { name: /Fotografie 2\sz/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "Nahrané fotografie (1)" })).toBeInTheDocument();
  });

  it("selhání smazání se hlásí a fotografie zůstane", async () => {
    const mediaActions = actions({
      remove: vi.fn(async () => ({ status: "unavailable" as const })),
    });
    const user = userEvent.setup();
    render(<Harness initial={[item(1)]} mediaActions={mediaActions} />);
    await user.click(screen.getByRole("button", { name: "Smazat fotografii 1" }));
    await user.click(screen.getByRole("button", { name: "Ano, smazat" }));
    expect(
      await screen.findByText("Fotografii se nepodařilo smazat. Zkuste to znovu."),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Fotografie 1\sz\s1/ })).toBeInTheDocument();
  });

  it("nezpracovaná a chybná fotografie z dřívějška se ukáže s vysvětlením a jde smazat", () => {
    render(
      <Harness
        initial={[
          item(1, {
            status: "failed",
            failureCode: "corrupt",
            widths: [],
            width: null,
            height: null,
          }),
          item(2, { status: "pending", widths: [], width: null, height: null }),
        ]}
        mediaActions={actions()}
      />,
    );
    expect(screen.getByText(/Soubor je poškozený nebo neúplný/)).toBeInTheDocument();
    expect(screen.getByText(/Nahrávání se nedokončilo/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Smazat fotografii/ })).toHaveLength(2);
    // bez zpracování nejde řadit ani popisovat
    expect(screen.queryByRole("button", { name: /Posunout fotografii/ })).toBeNull();
    expect(screen.queryByLabelText("Čeština")).toBeNull();
  });

  it("fotografie jen pro hosty s PINem: přepínač a upozornění, když PIN chybí", async () => {
    const onProtected = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={[item(1)]} mediaActions={actions()} spies={{ onProtected }} />);
    expect(screen.queryByText(/PIN hostů ještě není nastavený|nastavte/i)).toBeNull();
    await user.click(screen.getByLabelText("Fotografie zobrazit jen po zadání PINu hostů"));
    expect(onProtected).toHaveBeenCalledWith(true);
    expect(screen.getByText(/nejdou otevřít ani přímou adresou/)).toBeInTheDocument();
  });

  it("export: odkazy ke stažení s velikostí v MB; chyby slovy", async () => {
    const user = userEvent.setup();
    const mediaActions = actions();
    const { unmount } = render(<Harness initial={[item(1)]} mediaActions={mediaActions} />);
    await user.click(screen.getByRole("button", { name: "Stáhnout všechny fotografie" }));
    const link = await screen.findByRole("link", { name: /Stáhnout foto-01\.webp \(2\.4\sMB\)/ });
    expect(link).toHaveAttribute("href", "https://r2.example/d1");
    expect(link).toHaveAttribute("download", "foto-01.webp");
    unmount();

    render(
      <Harness
        initial={[item(1)]}
        mediaActions={actions({
          exportPhotos: vi.fn(async () => ({ status: "limited" as const, retryAfter: 9 })),
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Stáhnout všechny fotografie" }));
    expect(await screen.findByText(/Odkazy jste žádali příliš často/)).toBeInTheDocument();
  });

  it("export se bez hotové fotografie nenabízí", () => {
    render(<Harness initial={[]} mediaActions={actions()} />);
    expect(screen.queryByRole("button", { name: "Stáhnout všechny fotografie" })).toBeNull();
    expect(screen.getByText("Zatím žádné fotografie.")).toBeInTheDocument();
  });
});

describe("PhotosPanel: fronta nahrávání", () => {
  it("odmítnutý soubor má srozumitelnou chybu, bez opakování, a ohlásí se čtečce; odebrání ho uklidí", async () => {
    // (výběr souboru mimo `accept`, jako když ho obejde přetažení nebo jiný prohlížeč)
    const user = userEvent.setup({ applyAccept: false });
    const mediaActions = actions();
    render(<Harness initial={[]} mediaActions={mediaActions} />);
    const input = screen.getByLabelText("Vybrat fotografie");
    await user.upload(input, new File(["x"], "iphone.heic", { type: "image/heic" }));
    const queue = await screen.findByRole("list", { name: "Fronta nahrávání" });
    expect(within(queue).getByText("iphone.heic")).toBeInTheDocument();
    expect(within(queue).getByText(/Formát HEIC nepodporujeme/)).toBeInTheDocument();
    expect(within(queue).queryByRole("button", { name: /Zkusit znovu/ })).toBeNull();
    // živá oblast ohlásí chybu s názvem souboru
    expect(await screen.findByText(/iphone\.heic: Formát HEIC nepodporujeme/)).toBeInTheDocument();
    expect(mediaActions.requestUpload).not.toHaveBeenCalled();
    await user.click(
      within(queue).getByRole("button", { name: /Odebrat z\sfronty: iphone\.heic/ }),
    );
    expect(screen.queryByRole("list", { name: "Fronta nahrávání" })).toBeNull();
  });

  it("přechodná chyba nabízí Zkusit znovu s názvem souboru", async () => {
    const user = userEvent.setup();
    const mediaActions = actions({
      requestUpload: vi.fn(async () => ({ status: "limited" as const, retryAfter: 30 })),
    });
    render(<Harness initial={[]} mediaActions={mediaActions} />);
    await user.upload(
      screen.getByLabelText("Vybrat fotografie"),
      new File(["x"], "zamek.jpg", { type: "image/jpeg" }),
    );
    const queue = await screen.findByRole("list", { name: "Fronta nahrávání" });
    expect(
      await within(queue).findByText(/Za krátkou dobu je nahráváno příliš mnoho souborů/),
    ).toBeInTheDocument();
    expect(
      within(queue).getByRole("button", { name: "Zkusit znovu: zamek.jpg" }),
    ).toBeInTheDocument();
  });
});
