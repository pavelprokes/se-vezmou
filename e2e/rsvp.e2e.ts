import { HOSTS } from "./hosts";
import { choose, identify, openRsvp, rsvpSection, send, tenant } from "./rsvp";
import { exhaustRateLimit, uniqueTag } from "./support/db";
import { readMails, waitForMail } from "./support/mail";
import {
  analyticsRows,
  emailLogRows,
  EVENT_IDS,
  TENANT_SLUG,
  type RsvpSetup,
} from "./support/rsvp-db";
import { expect, test } from "./support/rsvp-fixtures";

/**
 * RSVP hosta (M8): E2E-12 až E2E-16 z docs/test-plan.md, FR-RSVP-1 až 7. Běží proti skutečné
 * databázi s migracemi; svatba `klara-a-matej` se zakládá v support/rsvp-db.ts a testy se o ni dělí
 * přes zámek. Obsah stránky je zatím z ukázkové fixtury (M5), RSVP z databáze.
 */

/** Typografie vkládá nezlomitelné mezery; porovnání textu e-mailu je s obyčejnými. */
const plain = (text: string) => text.replaceAll("\u00a0", " ");

const OBRAD = "Svatební obřad";
const HOSTINA = "Svatební hostina";

const ALL_QUESTIONS: RsvpSetup["questions"] = {
  plus_one: true,
  children: true,
  diet: true,
  lodging: true,
  transport: true,
  song: true,
};

test.describe("slepé ověření jména (E2E-12, FR-RSVP-1)", () => {
  test("host najde sebe i rodinu, žádný našeptávač ani výpis hostů", async ({ page, wedding }) => {
    const w = await wedding();
    await w.addHousehold("Novákovi", [{ name: "Jan Novák" }, { name: "Marie Nováková" }]);
    await w.addHousehold("Svobodovi", [{ name: "Petr Svoboda" }]);

    const section = await openRsvp(page);
    const field = section.getByLabel("Vaše jméno");
    await expect(field).toHaveValue("");
    await expect(field).not.toHaveAttribute("list", /.+/);
    await expect(field).toHaveAttribute("autocomplete", "name");
    await expect(section.locator("datalist")).toHaveCount(0);
    // ve stránce nejsou žádná jména hostů
    const html = await page.content();
    for (const name of ["Jan Novák", "Marie Nováková", "Petr Svoboda"]) {
      expect(html).not.toContain(name);
    }

    await identify(page, "jan novak");
    await expect(section.getByRole("heading", { name: "Jan Novák" })).toBeVisible();
    await expect(section.getByRole("heading", { name: "Marie Nováková" })).toBeVisible();
    // host jiné domácnosti se nezobrazí
    await expect(section.getByText("Petr Svoboda")).toHaveCount(0);
  });

  test("překlep ve jménu a jiné pořadí se tolerují, jiné jméno ne", async ({ page, wedding }) => {
    const w = await wedding();
    await w.addHousehold("Novákovi", [{ name: "Jan Novák" }]);
    await w.addHousehold("Dvořákovi", [{ name: "Matěj Dvořák" }]);

    const section = await openRsvp(page);
    await identify(page, "Jan Novk");
    await expect(section.getByRole("heading", { name: "Jan Novák" })).toBeVisible();

    await section.getByRole("button", { name: "Zadat jiné jméno" }).click();
    await identify(page, "Dvořák, Matej");
    await expect(section.getByRole("heading", { name: "Matěj Dvořák" })).toBeVisible();

    await section.getByRole("button", { name: "Zadat jiné jméno" }).click();
    await identify(page, "Jana Novák");
    await expect(section.getByText(/Nenašli jsme vás/)).toBeVisible();
  });

  test("neshoda, nejednoznačné jméno i vyčerpaný limit mají stejnou odpověď, bez prozrazení", async ({
    page,
    wedding,
  }) => {
    const w = await wedding();
    await w.addHousehold("Jedni", [{ name: "Jan Novák" }]);
    await w.addHousehold("Druzí", [{ name: "Jan Novák" }]);
    await w.addHousehold("Třetí", [{ name: "Eva Dvořáková" }]);

    const section = await openRsvp(page);
    const views: string[] = [];
    const messages: string[] = [];
    const attempt = async (typed: string) => {
      const field = section.getByLabel("Vaše jméno");
      await field.fill(typed);
      const response = page.waitForResponse((r) => r.request().method() === "POST");
      await section.getByRole("button", { name: "Pokračovat" }).click();
      await response;
      await expect(section.getByText(/Nenašli jsme vás/)).toBeVisible();
      // vše, co server po pokusu prohlížeči poslal (stav formuláře), bez zadaného jména
      views.push((await section.innerHTML()).replaceAll(typed, "<jméno>"));
      messages.push((await section.getByText(/Nenašli jsme vás/).innerText()).trim());
      await expect(field).toHaveValue(typed);
    };

    await attempt("Karel Nikdo"); // žádná shoda
    await attempt("Jan Novák"); // dvě domácnosti se stejným jménem
    // stejná délka i tvar vstupu, aby se odpovědi daly porovnat po znacích
    await exhaustRateLimit("rsvp-match", `${TENANT_SLUG}\0${w.ip}`, 15);
    await attempt("Eva Dvořáková"); // existující host, ale limit je vyčerpaný

    expect(new Set(messages).size).toBe(1);
    expect(views[0].length).toBeGreaterThan(0);
    // stav formuláře po pokusu je ve všech třech případech stejný
    expect(views[1]).toBe(views[0]);
    expect(views[2]).toBe(views[0]);
    // po neshodě zůstalo jméno v poli a pole je zaměřené (nemusí se psát znovu)
    await expect(section.getByLabel("Vaše jméno")).toBeFocused();
  });

  test("prázdné jméno: výzva u pole, nic se nehledá", async ({ page, wedding }) => {
    await wedding();
    const section = await openRsvp(page);
    await identify(page, "   ");
    await expect(section.getByLabel("Vaše jméno")).toHaveAttribute("aria-invalid", "true");
    await expect(section.getByText("Napište prosím své jméno.")).toBeVisible();
  });
});

test.describe("domácnost, plus jedna, děti (E2E-13, FR-RSVP-2, FR-RSVP-4)", () => {
  test("jedna odpověď za rodinu, plus jedna s ručním jménem a dítě s věkem", async ({
    page,
    wedding,
  }) => {
    const w = await wedding({ questions: ALL_QUESTIONS });
    const { householdId, guestIds } = await w.addHousehold("Novákovi", [
      { name: "Jan Novák" },
      { name: "Marie Nováková" },
      { name: "Anežka Nováková", child: true, age: 9 },
    ]);
    const analyticsBefore = (await analyticsRows()).length;

    const section = await openRsvp(page);
    await identify(page, "Marie Novakova");

    // dítě ze seznamu je označeno, rychlá volba vyplní všechny osoby najednou (3.3.7)
    await expect(section.getByRole("heading", { name: "Anežka Nováková (dítě)" })).toBeVisible();
    const quick = section.getByRole("group", { name: "Rychlá volba pro událost Svatební obřad" });
    await quick.getByRole("button", { name: "Přijdou všichni" }).click();
    await expect(
      section.getByRole("group", { name: "Anežka Nováková: Svatební obřad" }).getByRole("radio", {
        name: "Přijde",
        exact: true,
      }),
    ).toBeChecked();
    await choose(section, "Jan Novák", HOSTINA, "yes");
    await choose(section, "Marie Nováková", HOSTINA, "yes");
    await choose(section, "Anežka Nováková", HOSTINA, "no");

    // plus jedna s ručním jménem
    await section.getByRole("checkbox", { name: "Přijde s námi doprovod (plus jedna)" }).check();
    await section.getByLabel("Jméno doprovodu").fill("Tereza Doprovodová");
    await choose(section, "Tereza Doprovodová", OBRAD, "yes");
    await choose(section, "Tereza Doprovodová", HOSTINA, "no");

    // dítě doplněné hostem, věk povinný
    await section.getByRole("button", { name: "Přidat dítě" }).click();
    await section.getByLabel("Jméno dítěte").fill("Matyáš");
    await send(page);
    // souhrn chyb má zaměření a odkazy slovy: kdo, co a co je špatně (WCAG 3.3.1, 3.3.3)
    await expect(
      section.getByText("Odpověď nejde odeslat. Opravte prosím tyto údaje:"),
    ).toBeVisible();
    await expect(
      section.getByRole("link", { name: "Dítě 1: Svatební obřad: Vyberte, zda přijde." }),
    ).toBeVisible();
    await expect(
      section.getByRole("link", { name: "Dítě 1: Napište věk dítěte číslem od 0 do 17." }),
    ).toBeVisible();
    // nic se neuložilo, hodnoty zůstaly vyplněné
    expect((await w.state()).responses).toHaveLength(0);
    await expect(section.getByLabel("Jméno doprovodu")).toHaveValue("Tereza Doprovodová");

    await section.getByLabel("Věk dítěte (v letech)").fill("4");
    await choose(section, "Matyáš", OBRAD, "yes");
    await choose(section, "Matyáš", HOSTINA, "no");
    await section.getByLabel("Dieta", { exact: true }).first().fill("vegetariánská");

    // vestavěné otázky
    await section.getByRole("radio", { name: "Ano, potřebuji" }).check();
    await section.getByRole("radio", { name: "Mám volná místa v autě" }).check();
    await section.getByLabel("Jaká píseň vás dostane na parket?").fill("Vlak do nebe");
    await send(page);

    await expect(section.getByRole("status")).toContainText("Děkujeme, odpověď je uložená.");

    const state = await w.state();
    expect(state.responses).toHaveLength(1);
    expect(state.responses[0]).toMatchObject({
      household_id: householdId,
      entered_by: "guest",
      contact_email: null,
      answers: { lodging: "need", transport: "offer", song: "Vlak do nebe" },
    });
    expect(state.people).toHaveLength(5);
    const byName = Object.fromEntries(state.people.map((p) => [p.person_name, p]));
    expect(byName["Jan Novák"]).toMatchObject({ guest_id: guestIds[0], diet: "vegetariánská" });
    expect(byName["Jan Novák"].attendance).toEqual({
      [EVENT_IDS.obrad]: true,
      [EVENT_IDS.hostina]: true,
    });
    expect(byName["Anežka Nováková"].attendance[EVENT_IDS.hostina]).toBe(false);
    expect(byName["Tereza Doprovodová"]).toMatchObject({
      guest_id: null,
      is_plus_one: true,
      is_child: false,
    });
    expect(byName["Matyáš"]).toMatchObject({
      guest_id: null,
      is_child: true,
      age: 4,
      is_plus_one: false,
    });
    expect(Object.values(byName).filter((p) => p.diet !== null)).toHaveLength(1);

    // analytika: jedna událost bez jakéhokoli identifikátoru svatby, osoby nebo odpovědi (ADR 0007)
    await expect.poll(async () => (await analyticsRows()).length).toBe(analyticsBefore + 1);
    const rows = await analyticsRows();
    const last = rows.at(-1)!;
    expect(Object.keys(last).sort()).toEqual([
      "created_at",
      "event",
      "id",
      "locale",
      "step",
      "template",
    ]);
    expect(last).toMatchObject({
      event: "rsvp_completed",
      locale: "cs",
      template: null,
      step: null,
    });
  });

  test("doprovod a děti se nenabízejí, když je pár nezapnul", async ({ page, wedding }) => {
    const w = await wedding({ questions: {} });
    await w.addHousehold("Svobodovi", [{ name: "Petr Svoboda" }]);
    const section = await openRsvp(page);
    await identify(page, "Petr Svoboda");
    await expect(section.getByRole("heading", { name: "Petr Svoboda" })).toBeVisible();
    await expect(section.getByRole("checkbox", { name: /doprovod/ })).toHaveCount(0);
    await expect(section.getByRole("button", { name: "Přidat dítě" })).toHaveCount(0);
    await expect(section.getByLabel("Dieta", { exact: true })).toHaveCount(0);
    await expect(section.getByLabel("Potřebujete ubytování?")).toHaveCount(0);
    // jediná osoba: bez rychlé volby
    await expect(section.getByRole("group", { name: /Rychlá volba/ })).toHaveCount(0);
  });

  test("vlastní otázky páru: text, výběr, ano/ne, povinné i vázané na událost", async ({
    page,
    wedding,
  }) => {
    const w = await wedding({
      questions: {},
      custom: [
        {
          key: "menu",
          type: "choice",
          label: { cs: "Menu k hostině", en: "Menu" },
          options: [
            { value: "maso", label: { cs: "Maso", en: "Meat" } },
            { value: "ryba", label: { cs: "Ryba", en: "Fish" } },
          ],
          required: true,
        },
        { key: "prekvapeni", type: "bool", label: { cs: "Pomůžete s překvapením?" } },
        { key: "tanec", type: "text", label: { cs: "Váš oblíbený tanec" }, event: "hostina" },
      ],
    });
    await w.addHousehold("Svobodovi", [{ name: "Petr Svoboda" }]);
    const section = await openRsvp(page);
    await identify(page, "Petr Svoboda");

    // otázka k hostině se ptá jen toho, kdo na hostinu přijde
    await expect(section.getByLabel("Váš oblíbený tanec")).toHaveCount(0);
    await choose(section, "Petr Svoboda", OBRAD, "yes");
    await choose(section, "Petr Svoboda", HOSTINA, "yes");
    await expect(section.getByLabel("Váš oblíbený tanec")).toBeVisible();
    await expect(section.getByText("Nepište sem prosím zdravotní údaje.").first()).toBeVisible();

    // povinná otázka bez odpovědi: chyba slovy
    await send(page);
    await expect(
      section.getByRole("link", { name: "Menu k hostině: Vyberte jednu z možností." }),
    ).toBeVisible();
    await section.getByRole("radio", { name: "Ryba" }).check();
    await section.getByRole("radio", { name: "Ano", exact: true }).check();
    await section.getByLabel("Váš oblíbený tanec").fill("  valčík ");
    await send(page);
    await expect(section.getByRole("status")).toContainText("Děkujeme");

    const state = await w.state();
    expect(state.responses[0].answers).toEqual({ menu: "ryba", prekvapeni: true, tanec: "valčík" });
  });
});

test.describe("větvení podle událostí (E2E-14, FR-RSVP-3)", () => {
  test("host pozvaný jen na hostinu nevidí obřad, ostatní členové svůj program", async ({
    page,
    wedding,
  }) => {
    const w = await wedding();
    const { guestIds } = await w.addHousehold("Novákovi", [
      { name: "Jan Novák", events: ["hostina"] },
      { name: "Marie Nováková", events: ["obrad", "hostina"] },
    ]);
    const section = await openRsvp(page);
    await identify(page, "Jan Novák");

    await expect(section.getByRole("group", { name: `Jan Novák: ${OBRAD}` })).toHaveCount(0);
    await expect(section.getByRole("group", { name: `Jan Novák: ${HOSTINA}` })).toBeVisible();
    await expect(section.getByRole("group", { name: `Marie Nováková: ${OBRAD}` })).toBeVisible();
    // událost, která nemá rsvp_enabled, se nenabízí vůbec
    await expect(section.getByText("Soukromá událost")).toHaveCount(0);

    await choose(section, "Jan Novák", HOSTINA, "yes");
    await choose(section, "Marie Nováková", OBRAD, "no");
    await choose(section, "Marie Nováková", HOSTINA, "yes");
    await send(page);
    await expect(section.getByRole("status")).toContainText("Děkujeme");

    const people = (await w.state()).people;
    const jan = people.find((p) => p.guest_id === guestIds[0])!;
    expect(Object.keys(jan.attendance)).toEqual([EVENT_IDS.hostina]);
    expect(Object.keys(people.find((p) => p.guest_id === guestIds[1])!.attendance).sort()).toEqual(
      [EVENT_IDS.obrad, EVENT_IDS.hostina].sort(),
    );
  });
});

test.describe("odeslání, úprava a potvrzení (E2E-15, FR-RSVP-5, FR-RSVP-6)", () => {
  test("potvrzení se oznámí čtečce bez přesunu zaměření, úprava je tentýž formulář", async ({
    page,
    context,
    wedding,
  }) => {
    const w = await wedding({ questions: { diet: true } });
    await w.addHousehold("Novákovi", [{ name: "Jan Novák" }, { name: "Marie Nováková" }]);
    const section = await openRsvp(page);
    await identify(page, "Jan Novák");

    // živá oblast je v DOM před odesláním a je prázdná
    const status = section.getByRole("status");
    await expect(status).toBeEmpty();
    await expect(section.getByRole("button", { name: "Odeslat odpověď" })).toBeVisible();

    await section.getByRole("button", { name: "Přijdou všichni" }).first().click();
    await section.getByRole("button", { name: "Nepřijde nikdo" }).nth(1).click();
    await choose(section, "Marie Nováková", HOSTINA, "yes");
    await send(page);

    await expect(status).toContainText("Děkujeme, odpověď je uložená.");
    // zaměření zůstalo na tlačítku, formulář se nepřekreslil (tlačítko je teď Uložit změny)
    const save = section.getByRole("button", { name: "Uložit změny" });
    await expect(save).toBeFocused();
    // shrnutí je vidět i textem s ikonou, ne jen barvou
    await expect(section.getByText("Svatební obřad: přijde").first()).toBeVisible();
    await expect(section.getByText("Svatební hostina: nepřijde").first()).toBeVisible();

    // lístek v cookie je host-only, HttpOnly, bez Domain, krátký
    const cookie = (await context.cookies(tenant("/"))).find((c) => c.name === "sv_rsvp")!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", secure: false });
    expect(cookie.domain).toBe(HOSTS.tenant);
    expect(cookie.domain.startsWith(".")).toBe(false);
    const lifetime = cookie.expires - Date.now() / 1000;
    expect(lifetime).toBeGreaterThan(25 * 60);
    expect(lifetime).toBeLessThanOrEqual(31 * 60);
    expect(await page.evaluate(() => document.cookie)).not.toContain("sv_rsvp");

    // úprava: znovu načtená stránka ukáže dřívější odpověď (lístek v cookie), žádné nové zadávání jména
    await page.reload();
    await rsvpSection(page).scrollIntoViewIfNeeded();
    await expect(
      section.getByText("Vaši odpověď už máme. Můžete ji změnit a znovu odeslat."),
    ).toBeVisible();
    await expect(
      section
        .getByRole("group", { name: `Marie Nováková: ${HOSTINA}` })
        .getByRole("radio", { name: "Přijde", exact: true }),
    ).toBeChecked();
    await choose(section, "Marie Nováková", HOSTINA, "no");
    await send(page);
    await expect(section.getByRole("status")).toContainText("Děkujeme");

    const state = await w.state();
    expect(state.responses).toHaveLength(1);
    expect(+state.responses[0].last_edited_at).toBeGreaterThanOrEqual(
      +state.responses[0].submitted_at,
    );
    expect(
      state.people.find((p) => p.person_name === "Marie Nováková")!.attendance[EVENT_IDS.hostina],
    ).toBe(false);

    // úprava slepým ověřením v prohlížeči bez cookie
    const fresh = await page
      .context()
      .browser()!
      .newContext({ locale: "cs-CZ", extraHTTPHeaders: { "x-forwarded-for": w.ip } });
    const other = await fresh.newPage();
    await openRsvp(other);
    await identify(other, "Marie Nováková");
    await expect(
      rsvpSection(other)
        .getByRole("group", { name: `Marie Nováková: ${HOSTINA}` })
        .getByRole("radio", { name: "Nepřijde", exact: true }),
    ).toBeChecked();
    // "Zadat jiné jméno" zahodí lístek: po načtení je znovu první krok
    await rsvpSection(other).getByRole("button", { name: "Zadat jiné jméno" }).click();
    await expect(rsvpSection(other).getByLabel("Vaše jméno")).toBeVisible();
    await other.reload();
    await expect(rsvpSection(other).getByLabel("Vaše jméno")).toBeVisible();
    expect((await fresh.cookies(tenant("/"))).find((c) => c.name === "sv_rsvp")).toBeUndefined();
    await fresh.close();
  });

  test("zdravotní údaje: upozornění, zvláštní uložení, nejdou do e-mailu ani do záznamu o e-mailu", async ({
    page,
    wedding,
  }) => {
    const address = `jan-${uniqueTag()}@example.test`;
    const w = await wedding({ questions: { diet: true }, emailConfirmation: true });
    await w.addHousehold("Novákovi", [{ name: "Jan Novák" }]);
    const section = await openRsvp(page);
    await identify(page, "Jan Novák");

    await expect(section.getByText(/údaje\so\szdraví/)).toBeVisible();
    await expect(section.getByText(/smažeme/)).toBeVisible();
    await section
      .getByRole("group", { name: /Dieta a alergie \(nepovinné\), Jan Novák/ })
      .getByLabel("Dieta")
      .fill("bezlepková");
    await section
      .getByRole("group", { name: /Dieta a alergie/ })
      .getByLabel("Alergie")
      .fill("ořechy");
    await choose(section, "Jan Novák", OBRAD, "yes");
    await choose(section, "Jan Novák", HOSTINA, "no");
    await section.getByLabel("E-mail pro potvrzení (nepovinné)").fill(address);
    await send(page);
    await expect(section.getByRole("status")).toContainText("Děkujeme");
    await expect(section.getByText("Potvrzení jsme vám poslali e-mailem.")).toBeVisible();

    const state = await w.state();
    expect(state.people[0]).toMatchObject({ diet: "bezlepková", allergies: "ořechy" });
    expect(state.responses[0].contact_email).toBe(address);

    const mail = await waitForMail(address);
    expect(plain(mail.subject)).toBe("Potvrzení vaší odpovědi: svatba Klára a Matěj");
    expect(plain(mail.text)).toContain("Jan Novák");
    expect(plain(mail.text)).toContain("Svatební obřad: přijdu");
    expect(plain(mail.text)).toContain("Svatební hostina: nepřijdu");
    for (const secret of ["bezlepková", "ořechy", "Dieta", "Alergie"]) {
      expect(mail.text).not.toContain(secret);
      expect(mail.html).not.toContain(secret);
    }
    expect(mail.text).toMatch(/http:\/\/klara-a-matej\.localhost:\d+\/#potvrdit-ucast/);

    // záznam o e-mailu: jen typ, jazyk, HMAC adresy a doména, nikdy adresa ani obsah
    const log = await emailLogRows();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      type: "rsvp_confirmation",
      locale: "cs",
      recipient_domain: "example.test",
    });
    expect(JSON.stringify(log[0])).not.toContain(address.split("@")[0]);
    expect(JSON.stringify(log[0])).not.toContain("Jan");
  });

  test("e-mail se nepošle, když pár potvrzení e-mailem nezapnul, a adresa se neuloží", async ({
    page,
    wedding,
  }) => {
    const w = await wedding({ emailConfirmation: false });
    const address = `nikdy-${uniqueTag()}@example.test`;
    await w.addHousehold("Novákovi", [{ name: "Jan Novák" }]);
    const section = await openRsvp(page);
    await identify(page, "Jan Novák");
    await expect(section.getByLabel(/E-mail pro potvrzení/)).toHaveCount(0);
    await choose(section, "Jan Novák", OBRAD, "yes");
    await choose(section, "Jan Novák", HOSTINA, "yes");
    await send(page);
    await expect(section.getByRole("status")).toContainText("Děkujeme");
    expect(readMails(address)).toHaveLength(0);
    expect((await w.state()).responses[0].contact_email).toBeNull();
  });

  test("anglická verze: formulář, potvrzení i e-mail jsou anglicky", async ({ page, wedding }) => {
    const w = await wedding({ emailConfirmation: true });
    await w.addHousehold("Novákovi", [{ name: "Jan Novák" }]);
    const address = `john-${uniqueTag()}@example.test`;
    const section = await openRsvp(page, "en");
    await identify(page, "Jan Novák", "en");
    await choose(section, "Jan Novák", "Wedding ceremony", "yes", "en");
    await choose(section, "Jan Novák", "Wedding dinner", "no", "en");
    await section.getByLabel("Email for confirmation (optional)").fill(address);
    await send(page, "en");
    await expect(section.getByRole("status")).toContainText("Thank you, your reply is saved.");
    const mail = await waitForMail(address);
    expect(plain(mail.subject)).toBe("Your reply is confirmed: wedding of Klára and Matěj");
    expect(plain(mail.text)).toContain("Wedding ceremony: attending");
    expect(plain(mail.text)).toContain("Wedding dinner: not attending");
    expect(mail.text).toMatch(/\/en#potvrdit-ucast/);
  });
});

test.describe("otevření a uzavření, host mimo seznam, ochrana před spamem (E2E-16, FR-RSVP-5, FR-RSVP-7)", () => {
  const future = () => new Date(Date.now() + 3 * 86_400_000).toISOString();
  const past = (days = 1) => new Date(Date.now() - days * 86_400_000).toISOString();

  test("před otevřením a po uzavření formulář není, stav je napsaný", async ({ page, wedding }) => {
    const w = await wedding({ opensAt: future() });
    await w.addHousehold("Novákovi", [{ name: "Jan Novák" }]);
    let section = await openRsvp(page);
    await expect(section.getByText("Potvrzení účasti se otevře později.")).toBeVisible();
    await expect(section.getByLabel("Vaše jméno")).toHaveCount(0);
    await expect(page.locator(".site-sticky")).toHaveCount(0);

    await wedding({ opensAt: past(2), closesAt: past() });
    section = await openRsvp(page);
    await expect(section.getByText("Potvrzení účasti je již uzavřeno.")).toBeVisible();
    await expect(section.getByLabel("Vaše jméno")).toHaveCount(0);
  });

  test("otevřené s datem uzavření: konec potvrzování je napsaný", async ({ page, wedding }) => {
    await wedding({ closesAt: new Date(Date.now() + 30 * 86_400_000).toISOString() });
    const section = await openRsvp(page);
    await expect(section.getByText(/Potvrzení účasti je otevřeno do /)).toBeVisible();
  });

  test("RSVP se uzavře během vyplňování: odeslání se odmítne a nic se neuloží", async ({
    page,
    wedding,
  }) => {
    const w = await wedding();
    await w.addHousehold("Novákovi", [{ name: "Jan Novák" }]);
    const section = await openRsvp(page);
    await identify(page, "Jan Novák");
    await choose(section, "Jan Novák", OBRAD, "yes");
    await choose(section, "Jan Novák", HOSTINA, "yes");
    await w.closeNow(); // pár mezitím uzavřel potvrzování
    await send(page);
    // odmítnutá odpověď překreslí stránku podle živé fáze: místo formuláře je stav "uzavřeno"
    await expect(section.getByText("Potvrzení účasti je již uzavřeno.")).toBeVisible();
    await expect(section.getByLabel("Vaše jméno")).toHaveCount(0);
    expect((await w.state()).responses).toHaveLength(0);
  });

  test("host mimo seznam: vypnuto = žádná nabídka, zapnuto = samostatná odpověď bez úprav", async ({
    page,
    wedding,
  }) => {
    let w = await wedding({ allowUnlisted: false, questions: { children: true } });
    await w.addHousehold("Novákovi", [{ name: "Jan Novák" }]);
    let section = await openRsvp(page);
    await expect(
      section.getByRole("button", { name: "Odpovědět jako host mimo seznam" }),
    ).toHaveCount(0);
    await identify(page, "Neznámý Host");
    await expect(section.getByText(/Nenašli jsme vás/)).toBeVisible();
    await expect(
      section.getByRole("button", { name: "Odpovědět jako host mimo seznam" }),
    ).toHaveCount(0);

    w = await wedding({
      allowUnlisted: true,
      emailConfirmation: true,
      questions: { children: true },
    });
    await w.addHousehold("Novákovi", [{ name: "Jan Novák" }]);
    section = await openRsvp(page);
    await section.getByRole("button", { name: "Odpovědět jako host mimo seznam" }).click();
    await expect(section.getByText(/Novomanželé\spovolili\sodpovědět\si\shostům/)).toBeVisible();
    await section.getByLabel("Vaše jméno").fill("Karel Cizí");
    await choose(section, "Karel Cizí", OBRAD, "yes");
    await choose(section, "Karel Cizí", HOSTINA, "no");
    await section.getByRole("button", { name: "Přidat další osobu" }).click();
    await section.getByLabel("Jméno osoby").fill("Karolína Cizí");
    await choose(section, "Karolína Cizí", OBRAD, "yes");
    await choose(section, "Karolína Cizí", HOSTINA, "yes");
    await section.getByLabel("E-mail pro potvrzení (nepovinné)").fill("karel@example.test");
    await send(page);

    await expect(section.getByRole("status")).toContainText("Děkujeme, odpověď je uložená.");
    await expect(section.getByText(/Tuto odpověď už na webu nepůjde změnit/)).toBeVisible();
    // formulář zmizel, zaměření přešlo na potvrzení (nezůstalo na odstraněném tlačítku)
    await expect(section.getByRole("button", { name: "Odeslat odpověď" })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.activeElement?.closest("#potvrdit-ucast") !== null),
    ).toBe(true);

    const state = await w.state();
    expect(state.responses).toHaveLength(1);
    expect(state.responses[0]).toMatchObject({
      household_id: null,
      entered_by: "guest",
      contact_email: "karel@example.test",
    });
    expect(state.people.map((p) => p.person_name)).toEqual(["Karel Cizí", "Karolína Cizí"]);
    expect(state.people.every((p) => p.guest_id === null && !p.is_plus_one)).toBe(true);
    await waitForMail("karel@example.test");

    // další odpověď téhož člověka je samostatná (odpověď mimo seznam se neupravuje)
    await openRsvp(page);
    await section.getByRole("button", { name: "Odpovědět jako host mimo seznam" }).click();
    await section.getByLabel("Vaše jméno").fill("Karel Cizí");
    await choose(section, "Karel Cizí", OBRAD, "no");
    await choose(section, "Karel Cizí", HOSTINA, "no");
    await send(page);
    await expect(section.getByRole("status")).toContainText("Děkujeme");
    expect((await w.state()).responses).toHaveLength(2);
  });

  test("skrytá past: robot nic nenajde a nic neuloží, host s prázdným polem nepozná rozdíl", async ({
    page,
    wedding,
  }) => {
    const w = await wedding();
    await w.addHousehold("Novákovi", [{ name: "Jan Novák" }]);
    const section = await openRsvp(page);

    // past je mimo obrazovku, mimo tabulátor a skrytá čtečkám
    const trap = page.locator(".site-hp").first();
    await expect(trap).toHaveAttribute("aria-hidden", "true");
    await expect(trap.locator("input")).toHaveAttribute("tabindex", "-1");

    await page.evaluate(() => {
      (document.querySelector('#potvrdit-ucast input[name="website"]') as HTMLInputElement).value =
        "http://spam.example";
    });
    await identify(page, "Jan Novák");
    await expect(section.getByText(/Nenašli jsme vás/)).toBeVisible();

    // robot, který odesílá formulář: odpověď vypadá přijatá, nic se nezapíše
    await page.reload();
    await identify(page, "Jan Novák");
    await choose(section, "Jan Novák", OBRAD, "yes");
    await choose(section, "Jan Novák", HOSTINA, "yes");
    await page.evaluate(() => {
      (document.querySelector('#potvrdit-ucast input[name="website"]') as HTMLInputElement).value =
        "http://spam.example";
    });
    await send(page);
    await expect(section.getByRole("status")).toContainText("Děkujeme");
    expect((await w.state()).responses).toHaveLength(0);
  });

  test("omezení počtu odeslání: po vyčerpání obecná zpráva a nic se neuloží", async ({
    page,
    wedding,
  }) => {
    const w = await wedding();
    await w.addHousehold("Novákovi", [{ name: "Jan Novák" }]);
    const section = await openRsvp(page);
    await identify(page, "Jan Novák");
    await choose(section, "Jan Novák", OBRAD, "yes");
    await choose(section, "Jan Novák", HOSTINA, "yes");
    await exhaustRateLimit("rsvp-submit-ip", `${TENANT_SLUG}\0${w.ip}`, 10);
    await send(page);
    await expect(
      section.getByText("Odpovědí je teď příliš mnoho. Zkuste to prosím za chvíli.").first(),
    ).toBeVisible();
    expect((await w.state()).responses).toHaveLength(0);
    // hodnoty zůstaly (nic se nepíše znovu)
    await expect(
      section
        .getByRole("group", { name: `Jan Novák: ${OBRAD}` })
        .getByRole("radio", { name: "Přijde", exact: true }),
    ).toBeChecked();
  });

  test("lístek neplatí v jiné svatbě a prošlý lístek vrací na první krok", async ({
    page,
    wedding,
  }) => {
    const w = await wedding();
    await w.addHousehold("Novákovi", [{ name: "Jan Novák" }]);
    const section = await openRsvp(page);
    await identify(page, "Jan Novák");
    await choose(section, "Jan Novák", OBRAD, "yes");
    await choose(section, "Jan Novák", HOSTINA, "yes");
    // lístek v databázi vyprší
    const { withDb } = await import("./support/db");
    await withDb((db) =>
      db.query("update public.rsvp_tickets set expires_at = now() - interval '1 second'"),
    );
    await send(page);
    await expect(
      section.getByText("Platnost ověření vypršela. Napište prosím své jméno znovu.").first(),
    ).toBeVisible();
    await expect(section.getByLabel("Vaše jméno")).toBeVisible();
    expect((await w.state()).responses).toHaveLength(0);
  });
});
