import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { appUrl } from "./support/admin";
import { withDb } from "./support/db";
import { eventIds, seedHouseholds, seedSite } from "./support/guests";

/**
 * Zasedací pořádek (docs/plan-funkci-2026-10.md, fáze 2): předvolba tvaru U, usazení domácnosti najednou
 * a jednotlivě výběrem stolu (klávesnicí, bez tahání), plný stůl, pořadí míst, uložení, tisk a změna
 * rozložení, která místa uvolní.
 */

/** Odpověď domácnosti přímo v databázi: všichni přijdou na hostinu, `extra` jako doprovod. */
async function answer(weddingId: string, householdId: string, extra?: string) {
  const events = await eventIds(weddingId);
  await withDb(async (db) => {
    await db.query("begin");
    const response = randomUUID();
    await db.query(
      "insert into se_vezmou.rsvp_responses (id, wedding_id, household_id, answers) values ($1, $2, $3, '{}')",
      [response, weddingId, householdId],
    );
    const guests = await db.query<{ id: string; display_name: string }>(
      "select id, display_name from se_vezmou.guests where household_id = $1 order by created_at, id",
      [householdId],
    );
    const people = guests.rows.map((g) => ({ guest: g.id, name: g.display_name, plus: false }));
    if (extra) people.push({ guest: null as unknown as string, name: extra, plus: true });
    for (const person of people) {
      const id = randomUUID();
      await db.query(
        `insert into se_vezmou.rsvp_people (id, wedding_id, response_id, guest_id, person_name, is_plus_one, created_at)
         values ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
        [id, weddingId, response, person.guest, person.name, person.plus],
      );
      await db.query(
        "insert into se_vezmou.rsvp_attendance (wedding_id, person_id, event_id, attending) values ($1, $2, $3, true)",
        [weddingId, id, events.reception],
      );
    }
    await db.query("commit");
  });
}

test.describe("zasedací pořádek", () => {
  test("tvar U, usazení domácnosti i jednotlivě, plný stůl, pořadí, tisk a nové rozložení", async ({
    page,
    context,
  }, info) => {
    const site = await seedSite();
    const [novakovi, svobodovi] = await seedHouseholds(site.weddingId, [
      { label: "Novákovi", guests: [{ name: "Jan Novák" }, { name: "Marie Nováková" }] },
      { label: "Svobodovi", guests: [{ name: "Petr Svoboda" }] },
      { label: "Neodpověděli", guests: [{ name: "Karel Tichý" }] },
    ]);
    await answer(site.weddingId, novakovi);
    await answer(site.weddingId, svobodovi, "Eva Malá");
    await site.login(context);

    // ze seznamu hostů na zasedací pořádek
    await page.goto(appUrl("/hoste"));
    await page.getByRole("link", { name: "Otevřít zasedací pořádek" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Zasedací pořádek" })).toBeVisible();
    await expect(page.getByText("Zatím nemáte žádné stoly.")).toBeVisible();

    // tvar U: hlavní stůl pro 2, ramena po 4 z vnější i vnitřní strany
    await page.getByRole("radio", { name: "Tvar U", exact: true }).check();
    await page.getByLabel("Míst u hlavního stolu (jen jedna strana)").fill("2");
    await page.getByLabel("Míst na jedné straně dlouhého stolu").fill("4");
    await expect(page.getByTestId("seating-preview-capacity")).toHaveText(
      "Míst celkem: 18 · hostů k usazení: 4",
    );
    await page.getByRole("button", { name: "Vytvořit stoly" }).click();
    await expect(page.getByText("Rozložení je nastavené.")).toBeVisible();
    await expect(page.getByTestId("seating-map")).toBeVisible();
    await expect(page.getByTestId("seating-count")).toHaveText("Usazeno 0 z 4");
    // host, který neodpověděl, se neusazuje
    await expect(page.getByText("Karel Tichý")).toHaveCount(0);

    // domácnost najednou ke hlavnímu stolu
    await page.getByLabel("Celou domácnost Novákovi ke stolu").selectOption("celo");
    await expect(page.getByTestId("table-celo")).toHaveText("Hlavní stůl · obsazeno 2 z 2");
    // plný stůl nejde vybrat
    const eva = page.getByLabel("Stůl pro Eva Malá");
    await expect(eva.locator('option[value="celo"]')).toBeDisabled();
    await page.getByLabel("Stůl pro Petr Svoboda").selectOption("l");
    await eva.selectOption("p");
    await expect(page.getByTestId("seating-count")).toHaveText("Usazeno 4 z 4");

    // pořadí míst u stolu
    await page.getByRole("button", { name: "Posunout Marie Nováková o místo dopředu" }).click();
    const head = page.getByTestId("table-celo").locator("xpath=..");
    await expect(head.getByRole("listitem").first()).toContainText("1. Marie Nováková");
    await expect(page.getByText("Plán je uložený.")).toBeVisible();
    await page.screenshot({ path: info.outputPath("zasedaci-poradek.png"), fullPage: true });

    // uloženo: po načtení stejné
    await page.reload();
    await expect(page.getByTestId("seating-count")).toHaveText("Usazeno 4 z 4");
    await expect(
      page.getByTestId("table-celo").locator("xpath=..").getByRole("listitem").first(),
    ).toContainText("1. Marie Nováková");
    const stored = await withDb((db) =>
      db.query<{ rev: number; n: number }>(
        "select rev, (select count(*) from jsonb_object_keys(plan -> 'assignments'))::int as n from se_vezmou.seating_plans where wedding_id = $1",
        [site.weddingId],
      ),
    );
    expect(stored.rows[0].n).toBe(4);
    expect(stored.rows[0].rev).toBeGreaterThan(0);
    // v plánu nejsou jména, jen klíče
    const raw = await withDb((db) =>
      db.query<{ plan: string }>(
        "select plan::text as plan from se_vezmou.seating_plans where wedding_id = $1",
        [site.weddingId],
      ),
    );
    expect(raw.rows[0].plan).not.toContain("Nováková");

    // tisk: plánek, hosté po stolech a abecední seznam
    await page.getByRole("link", { name: "Tisk plánku a seznamů" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Plánek sálu" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Hosté po stolech" })).toBeVisible();
    const names = page.getByRole("table", { name: "Kdo kde sedí (podle abecedy)" });
    await expect(names.getByRole("row", { name: "Eva Malá Pravé rameno" })).toBeVisible();
    await expect(names.getByRole("row", { name: "Jan Novák Hlavní stůl" })).toBeVisible();
    await page.screenshot({ path: info.outputPath("zasedaci-poradek-tisk.png"), fullPage: true });

    // nové rozložení bez původních stolů místa uvolní
    await page.getByRole("link", { name: "Zpět k zasedacímu pořádku" }).click();
    await page.getByRole("radio", { name: "Kulaté stoly", exact: true }).check();
    await page.getByLabel("Počet stolů").fill("2");
    await page.getByLabel("Míst u kulatého stolu").fill("4");
    await page.getByRole("button", { name: "Použít nové rozložení" }).click();
    await expect(
      page.getByText(/Hostů bez místa \(stůl zmizel nebo se zmenšil\): 4/),
    ).toBeVisible();
    await expect(page.getByTestId("seating-count")).toHaveText("Usazeno 0 z 4");
    await page.getByLabel("Ukázat jen hosty bez místa").check();
    await expect(page.getByLabel(/^Stůl pro /)).toHaveCount(4);
  });

  test("souběžná úprava jiného správce se nahlásí slovy", async ({ page, context }) => {
    const site = await seedSite();
    const [household] = await seedHouseholds(site.weddingId, [
      { label: "Novákovi", guests: [{ name: "Jan Novák" }] },
    ]);
    await answer(site.weddingId, household);
    await site.login(context);
    await page.goto(appUrl("/hoste/zasedaci-poradek"));
    await page.getByRole("button", { name: "Vytvořit stoly" }).click();
    await expect(page.getByText("Plán je uložený.")).toBeVisible();
    // jiný správce mezitím uložil
    await withDb((db) =>
      db.query("update se_vezmou.seating_plans set rev = rev + 5 where wedding_id = $1", [
        site.weddingId,
      ]),
    );
    await page.getByLabel("Stůl pro Jan Novák").selectOption("t1");
    await expect(page.getByText(/Plán mezitím upravil jiný správce/)).toBeVisible();
  });
});
