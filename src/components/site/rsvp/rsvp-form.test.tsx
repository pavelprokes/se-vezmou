// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  matchAction: vi.fn(),
  unlistedAction: vi.fn(),
  submitAction: vi.fn(),
  resetAction: vi.fn(),
  unlockAction: vi.fn(),
}));
vi.mock("../actions", () => actions);

import { createTranslator } from "@/i18n/translator";
import { buildListedModel, buildUnlistedModel, type RsvpState } from "@/lib/rsvp/form";
import {
  E_HOSTINA,
  E_OBRAD,
  G_JAN,
  G_MARIE,
  householdView,
  unlistedView,
} from "@/lib/rsvp/test-fixtures";
import { rsvpLabels } from "./labels";
import { RsvpForm } from "./rsvp-form";

const labels = rsvpLabels(createTranslator("cs"));
const enLabels = rsvpLabels(createTranslator("en"));

const listedState = (overrides = {}): RsvpState => ({
  stage: "form",
  model: buildListedModel(householdView(overrides), "cs"),
});

function renderForm(
  initial: RsvpState = { stage: "name" },
  props: { allowUnlisted?: boolean; closes?: string | null; l?: typeof labels } = {},
) {
  return render(
    <RsvpForm
      labels={props.l ?? labels}
      locale="cs"
      initial={initial}
      allowUnlisted={props.allowUnlisted ?? false}
      closes={props.closes ?? null}
    />,
  );
}

beforeEach(() => {
  for (const mock of Object.values(actions)) mock.mockReset();
});

describe("krok 1: jméno (FR-RSVP-1)", () => {
  it("prázdné pole s popiskem, bez našeptávače, s nápovědou o soukromí a se skrytou pastí", () => {
    const { container } = renderForm();
    const field = screen.getByLabelText("Vaše jméno");
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("autocomplete", "name");
    expect(field).not.toHaveAttribute("list");
    expect(container.querySelector("datalist")).toBeNull();
    expect(field).toBeRequired();
    const hint = document.getElementById(field.getAttribute("aria-describedby")!);
    expect(hint).toHaveTextContent(/Seznam hostů nikde nezobrazujeme/);

    const trap = container.querySelector(".site-hp")!;
    expect(trap).toHaveAttribute("aria-hidden", "true");
    expect(trap.querySelector("input")).toHaveAttribute("tabindex", "-1");
    expect(trap.querySelector("input")).toHaveAttribute("name", "website");
  });

  it("odešle jméno i jazyk; neshoda se oznámí v živé oblasti a jméno zůstane v poli", async () => {
    actions.matchAction.mockResolvedValue({
      stage: "name",
      error: "not_found",
      value: "Karel Nikdo",
    });
    const user = userEvent.setup();
    renderForm();
    const field = screen.getByLabelText("Vaše jméno");
    await user.type(field, "Karel Nikdo");
    await user.click(screen.getByRole("button", { name: "Pokračovat" }));

    const message = await screen.findByText(/Nenašli jsme vás/);
    expect(message.closest("[role=alert]")).not.toBeNull();
    expect(field).toHaveValue("Karel Nikdo");
    expect(field).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(field).toHaveFocus());
    const sent = actions.matchAction.mock.calls[0][0] as FormData;
    expect(sent.get("name")).toBe("Karel Nikdo");
    expect(sent.get("locale")).toBe("cs");
    expect(sent.get("website")).toBe("");
  });

  it("zaměří pole po každé chybě, i podruhé stejné", async () => {
    actions.matchAction.mockResolvedValue({ stage: "name", error: "not_found", value: "Karel" });
    const user = userEvent.setup();
    renderForm();
    const field = screen.getByLabelText("Vaše jméno");
    await user.type(field, "Karel");
    await user.click(screen.getByRole("button", { name: "Pokračovat" }));
    await waitFor(() => expect(field).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Pokračovat" }));
    await waitFor(() => expect(actions.matchAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(field).toHaveFocus());
  });

  it("výjimka při volání serveru dá obecnou chybu, ne prázdnou stránku", async () => {
    actions.matchAction.mockRejectedValue(new Error("síť"));
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Vaše jméno"), "Jan");
    await user.click(screen.getByRole("button", { name: "Pokračovat" }));
    expect(
      await screen.findByText("Něco se nepovedlo. Zkuste to prosím znovu."),
    ).toBeInTheDocument();
  });

  it("nabídka hosta mimo seznam je jen když ji pár povolil", async () => {
    const { unmount } = renderForm();
    expect(screen.queryByRole("button", { name: "Odpovědět jako host mimo seznam" })).toBeNull();
    unmount();

    actions.unlistedAction.mockResolvedValue({
      stage: "form",
      model: buildUnlistedModel(unlistedView(), "cs"),
    });
    const user = userEvent.setup();
    renderForm({ stage: "name" }, { allowUnlisted: true });
    await user.click(screen.getByRole("button", { name: "Odpovědět jako host mimo seznam" }));
    expect(
      await screen.findByLabelText("Vaše jméno", { selector: "input[name='x.0.name']" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Novomanželé povolili odpovědět i hostům mimo seznam/),
    ).toBeInTheDocument();
    // host mimo seznam nemá uvedeného nikoho ze seznamu a nevidí tlačítko "Zadat jiné jméno"
    expect(screen.queryByRole("button", { name: "Zadat jiné jméno" })).toBeNull();
  });

  it("konec potvrzování je napsaný", () => {
    renderForm({ stage: "name" }, { closes: "30. dubna 2027" });
    expect(screen.getByText("Potvrzení účasti je otevřeno do 30. dubna 2027.")).toBeInTheDocument();
  });
});

describe("krok 2: formulář domácnosti (FR-RSVP-2, FR-RSVP-3, FR-RSVP-4)", () => {
  it("každý host má jen své pozvané události, dítě ze seznamu je označeno", () => {
    renderForm(listedState());
    expect(screen.getByRole("heading", { name: "Jan Novák" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Anežka Nováková (dítě)" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Jan Novák: Svatební obřad" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Jan Novák: Svatební hostina" })).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Anežka Nováková: Svatební obřad" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Anežka Nováková: Svatební hostina" })).toBeNull();
    // čas události je napsaný ve skupině
    expect(screen.getAllByText(/Kdy: .*14:00/).length).toBeGreaterThan(0);
  });

  it("rychlá volba vyplní odpověď za všechny najednou, jednotlivě jde přepsat", async () => {
    const user = userEvent.setup();
    renderForm(listedState());
    const quick = screen.getByRole("group", { name: "Rychlá volba pro událost Svatební obřad" });
    await user.click(within(quick).getByRole("button", { name: "Přijdou všichni" }));
    const radio = (person: string, event: string, value: string) =>
      within(screen.getByRole("group", { name: `${person}: ${event}` })).getByRole("radio", {
        name: value,
      });
    expect(radio("Jan Novák", "Svatební obřad", "Přijde")).toBeChecked();
    expect(radio("Marie Nováková", "Svatební obřad", "Přijde")).toBeChecked();
    expect(radio("Anežka Nováková", "Svatební obřad", "Přijde")).toBeChecked();
    expect(radio("Jan Novák", "Svatební hostina", "Přijde")).not.toBeChecked();

    await user.click(radio("Marie Nováková", "Svatební obřad", "Nepřijde"));
    expect(radio("Marie Nováková", "Svatební obřad", "Nepřijde")).toBeChecked();
    await user.click(
      within(
        screen.getByRole("group", { name: "Rychlá volba pro událost Svatební hostina" }),
      ).getByRole("button", { name: "Nepřijde nikdo" }),
    );
    expect(radio("Jan Novák", "Svatební hostina", "Nepřijde")).toBeChecked();
  });

  it("plus jedna s ručním jménem a děti s věkem: přidání, pole, odebrání", async () => {
    const user = userEvent.setup();
    renderForm(listedState());
    expect(screen.queryByLabelText("Jméno doprovodu")).toBeNull();
    await user.click(
      screen.getByRole("checkbox", { name: /Přijde s\snámi doprovod \(plus jedna\)/ }),
    );
    await user.type(screen.getByLabelText("Jméno doprovodu"), "Tereza");
    // legendy skupin nesou zadané jméno
    expect(screen.getByRole("group", { name: "Tereza: Svatební obřad" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Přidat dítě" }));
    expect(screen.getByRole("heading", { name: "Dítě 1" })).toBeInTheDocument();
    expect(screen.getByLabelText("Věk dítěte (v letech)")).toHaveAttribute("inputmode", "numeric");
    await user.click(screen.getByRole("button", { name: "Přidat dítě" }));
    expect(screen.getByRole("heading", { name: "Dítě 2" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Odebrat dítě 1" }));
    expect(screen.queryByRole("heading", { name: "Dítě 2" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Dítě 1" })).toBeInTheDocument();

    await user.click(
      screen.getByRole("checkbox", { name: /Přijde s\snámi doprovod \(plus jedna\)/ }),
    );
    expect(screen.queryByLabelText("Jméno doprovodu")).toBeNull();
  });

  it("nabídky se řídí nastavením páru: bez doprovodu, dětí, diety a otázek formulář nic z toho nemá", () => {
    renderForm(listedState({ settings: { enabled_questions: {}, email_confirmation: false } }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Přidat dítě" })).toBeNull();
    expect(screen.queryByLabelText("Dieta")).toBeNull();
    expect(screen.queryByText("Potřebujete ubytování?")).toBeNull();
    expect(screen.queryByLabelText(/E-mail pro potvrzení/)).toBeNull();
  });

  it("zdravotní údaje: nepovinné, s jasným upozorněním u každé osoby", () => {
    renderForm(listedState());
    const notices = screen.getAllByText(/Dieta a alergie jsou údaje o zdraví/);
    expect(notices).toHaveLength(3);
    expect(
      screen.getByRole("group", { name: /Dieta a\salergie \(nepovinné\), Jan Novák/ }),
    ).toBeInTheDocument();
    for (const field of screen.getAllByLabelText("Dieta")) expect(field).not.toBeRequired();
    for (const field of screen.getAllByLabelText("Alergie")) expect(field).not.toBeRequired();
  });

  it("otázka k události se ukáže, až když někdo na událost přijde; povinná se označí slovem", async () => {
    const user = userEvent.setup();
    renderForm(
      listedState({
        questions: [
          {
            id: "q1",
            key: "tanec",
            type: "text",
            label: { cs: "Váš oblíbený tanec" },
            options: null,
            required: true,
            event_id: E_HOSTINA,
          },
        ],
      }),
    );
    expect(screen.queryByLabelText(/Váš oblíbený tanec/)).toBeNull();
    await user.click(
      within(screen.getByRole("group", { name: "Jan Novák: Svatební hostina" })).getByRole(
        "radio",
        {
          name: "Přijde",
        },
      ),
    );
    const field = screen.getByLabelText("Váš oblíbený tanec (povinné)");
    expect(field).toBeRequired();
    expect(
      screen.getByText(/Zdravotní údaje prosím napište do pole Dieta a alergie/),
    ).toBeInTheDocument();
  });

  it("anglické texty z `labels`: nic česky nezůstane", () => {
    render(
      <RsvpForm
        labels={enLabels}
        locale="en"
        initial={listedState()}
        allowUnlisted={false}
        closes={null}
      />,
    );
    expect(screen.getByText(/Please reply for your whole household/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send reply" })).toBeInTheDocument();
    expect(screen.queryByText(/Odeslat|Přijde/)).toBeNull();
  });
});

describe("odeslání, chyby a potvrzení (FR-RSVP-5, FR-RSVP-6)", () => {
  async function fillAll(user: ReturnType<typeof userEvent.setup>) {
    for (const quick of screen.getAllByRole("button", { name: "Přijdou všichni" })) {
      await user.click(quick);
    }
  }

  it("odešle pole se jmény podle schématu a jazyk; honeypot a režim jdou s formulářem", async () => {
    actions.submitAction.mockResolvedValue({
      stage: "form",
      done: { people: [], emailSent: false, unlisted: false },
    });
    const user = userEvent.setup();
    renderForm(listedState());
    await fillAll(user);
    await user.type(screen.getAllByLabelText("Dieta")[0], "bezlepková");
    await user.click(screen.getByRole("button", { name: "Odeslat odpověď" }));
    await waitFor(() => expect(actions.submitAction).toHaveBeenCalled());
    const sent = actions.submitAction.mock.calls[0][0] as FormData;
    expect(sent.get(`g.${G_JAN}.ev.${E_OBRAD}`)).toBe("yes");
    expect(sent.get(`g.${G_MARIE}.ev.${E_HOSTINA}`)).toBe("yes");
    expect(sent.get(`g.${G_JAN}.diet`)).toBe("bezlepková");
    expect(sent.get("mode")).toBe("listed");
    expect(sent.get("locale")).toBe("cs");
    expect(sent.get("website")).toBe("");
    // lístek nikdy neodchází z formuláře: je v cookie, kterou prohlížeč nevidí
    expect([...sent.keys()].some((k) => /ticket|token/i.test(k))).toBe(false);
  });

  it("chyby: souhrn s odkazy má zaměření, odkaz zaměří pole, hodnoty zůstanou, text je slovy", async () => {
    actions.submitAction.mockResolvedValue({
      stage: "form",
      error: "invalid",
      errors: { [`g.${G_MARIE}.ev.${E_HOSTINA}`]: "required" },
    });
    const user = userEvent.setup();
    renderForm(listedState());
    await user.click(
      within(screen.getByRole("group", { name: "Jan Novák: Svatební obřad" })).getByRole("radio", {
        name: "Přijde",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Odeslat odpověď" }));

    const link = await screen.findByRole("link", {
      name: "Marie Nováková: Svatební hostina: Vyberte, zda přijde.",
    });
    const summary = link.closest(".site-error-summary") as HTMLElement;
    await waitFor(() => expect(summary).toHaveFocus());
    expect(
      screen.getByText("Odpověď nejde odeslat. Opravte prosím tyto údaje:"),
    ).toBeInTheDocument();
    // chyba je i u pole: text, ikona (SVG), nejen barva
    const group = screen.getByRole("group", { name: "Marie Nováková: Svatební hostina" });
    expect(within(group).getByText("Vyberte, zda přijde.")).toBeInTheDocument();
    expect(group.querySelector("svg")).not.toBeNull();
    // už zadané zůstalo
    expect(
      within(screen.getByRole("group", { name: "Jan Novák: Svatební obřad" })).getByRole("radio", {
        name: "Přijde",
      }),
    ).toBeChecked();

    await user.click(link);
    expect(within(group).getAllByRole("radio")[0]).toHaveFocus();
  });

  it("potvrzení je ve stálé živé oblasti, zaměření zůstane na tlačítku a formulář se mění na úpravu", async () => {
    const model = buildListedModel(householdView(), "cs");
    actions.submitAction.mockResolvedValue({
      stage: "form",
      model: { ...model, existing: true },
      done: {
        people: [
          {
            name: "Jan Novák",
            rows: [
              { event: "Svatební obřad", attending: true },
              { event: "Svatební hostina", attending: false },
            ],
          },
        ],
        emailSent: true,
        unlisted: false,
      },
    });
    const user = userEvent.setup();
    renderForm(listedState());
    const status = screen.getByRole("status");
    expect(status).toBeEmpty();
    await fillAll(user);
    const send = screen.getByRole("button", { name: "Odeslat odpověď" });
    send.focus();
    await user.click(send);

    await waitFor(() => expect(status).toHaveTextContent("Děkujeme, odpověď je uložená."));
    expect(screen.getByText("Potvrzení jsme vám poslali e-mailem.")).toBeInTheDocument();
    expect(
      screen.getByText(/Odpověď můžete do uzavření potvrzování změnit níže/),
    ).toBeInTheDocument();
    // shrnutí textem s ikonou
    const row = screen.getByText("Svatební hostina: nepřijde");
    expect(row.parentElement!.querySelector("svg")).not.toBeNull();
    // zaměření nikam neodskočilo: tlačítko je to samé, jen se jmenuje Uložit změny
    const save = await screen.findByRole("button", { name: "Uložit změny" });
    expect(save).toBe(send);
    expect(save).toHaveFocus();
  });

  it("host mimo seznam: po odeslání formulář zmizí a zaměření přejde na potvrzení", async () => {
    actions.unlistedAction.mockResolvedValue({
      stage: "form",
      model: buildUnlistedModel(unlistedView(), "cs"),
    });
    actions.submitAction.mockResolvedValue({
      stage: "form",
      done: {
        people: [{ name: "Karel", rows: [{ event: "Svatební obřad", attending: true }] }],
        emailSent: false,
        unlisted: true,
      },
    });
    const user = userEvent.setup();
    renderForm({ stage: "name" }, { allowUnlisted: true });
    await user.click(screen.getByRole("button", { name: "Odpovědět jako host mimo seznam" }));
    await user.type(await screen.findByLabelText("Vaše jméno"), "Karel");
    await user.click(screen.getByRole("button", { name: "Odeslat odpověď" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Děkujeme"));
    expect(screen.queryByRole("button", { name: /Odeslat odpověď|Uložit změny/ })).toBeNull();
    expect(screen.getByText(/Tuto odpověď už na webu nepůjde změnit/)).toBeInTheDocument();
    const region = screen.getByText("Shrnutí odpovědi").closest("[tabindex='-1']");
    await waitFor(() => expect(region).toHaveFocus());
  });

  it("obecné chyby serveru: limit, uzavřeno, neplatný lístek", async () => {
    const user = userEvent.setup();
    actions.submitAction.mockResolvedValueOnce({ stage: "form", error: "limited" });
    renderForm(listedState());
    await user.click(screen.getByRole("button", { name: "Odeslat odpověď" }));
    expect(
      await screen.findByText("Odpovědí je teď příliš mnoho. Zkuste to prosím za chvíli."),
    ).toBeInTheDocument();

    actions.submitAction.mockResolvedValueOnce({ stage: "closed" });
    await user.click(screen.getByRole("button", { name: "Odeslat odpověď" }));
    expect(await screen.findByText(/Potvrzení účasti mezitím skončilo/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Vaše jméno")).toBeNull();
  });

  it("expirovaný lístek vrací první krok s vysvětlením", async () => {
    actions.submitAction.mockResolvedValue({ stage: "name", error: "expired" });
    const user = userEvent.setup();
    renderForm(listedState());
    await user.click(screen.getByRole("button", { name: "Odeslat odpověď" }));
    expect(
      await screen.findByText("Platnost ověření vypršela. Napište prosím své jméno znovu."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Vaše jméno")).toBeInTheDocument();
  });

  it('"Zadat jiné jméno" zahodí lístek na serveru a vrátí první krok', async () => {
    actions.resetAction.mockResolvedValue({ stage: "name" });
    const user = userEvent.setup();
    renderForm(listedState());
    await user.click(screen.getByRole("button", { name: "Zadat jiné jméno" }));
    expect(await screen.findByLabelText("Vaše jméno")).toHaveValue("");
    expect(actions.resetAction).toHaveBeenCalledTimes(1);
  });

  it("dvojí odeslání během čekání se ignoruje a tlačítko si drží zaměření (není disabled)", async () => {
    let finish: (value: RsvpState) => void = () => undefined;
    actions.submitAction.mockImplementation(
      () => new Promise<RsvpState>((resolve) => (finish = resolve)),
    );
    const user = userEvent.setup();
    renderForm(listedState());
    const send = screen.getByRole("button", { name: "Odeslat odpověď" });
    send.focus();
    await user.click(send);
    await waitFor(() => expect(send).toHaveAttribute("aria-disabled", "true"));
    expect(send).not.toBeDisabled();
    expect(send).toHaveFocus();
    expect(send).toHaveTextContent("Odesílám…");
    await user.click(send);
    expect(actions.submitAction).toHaveBeenCalledTimes(1);
    finish({ stage: "form", error: "invalid" });
    await waitFor(() => expect(send).not.toHaveAttribute("aria-disabled"));
  });
});
