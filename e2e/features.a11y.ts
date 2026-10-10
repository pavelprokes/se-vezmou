import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type { EditorBlock } from "../src/admin/site/doc";
import { appUrl, tenantUrl } from "./support/admin";
import { withDb } from "./support/db";
import { expect, test } from "./support/fixtures";
import { eventIds, seedHouseholds, seedSite } from "./support/guests";

/**
 * Přístupnost funkcí z plánu 2026-10 (WCAG 2.2 AA): cedulka s QR galerie, vzkazy a upozornění hostům
 * v přehledu odpovědí, zasedací pořádek (i tisková stránka), seznam darů ve správě i na webu, poznámky
 * a dodavatelé, odhlášení upozornění a RSVP formulář se vzkazem a upozorněním. Běží na počítači
 * i v mobilním viewportu.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page) {
  await expect(page).toHaveTitle(/.+/);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}

const enable = (blocks: EditorBlock[]): EditorBlock[] =>
  blocks.map((block) =>
    block.type === "gifts"
      ? ({ ...block, enabled: true, data: { ...block.data, account: "" } } as EditorBlock)
      : block.type === "gallery"
        ? ({
            ...block,
            enabled: true,
            data: {
              ...block.data,
              link: {
                url: "https://photos.svatebni-fotograf-cechy.cz/s/a11y/klara-a-matej",
                protected: false,
                card: null,
              },
            },
          } as EditorBlock)
        : block,
  );

async function seedAnswered(weddingId: string) {
  const [household] = await seedHouseholds(weddingId, [
    { label: "Novákovi", guests: [{ name: "Jan Novák" }, { name: "Marie Nováková" }] },
  ]);
  const events = await eventIds(weddingId);
  await withDb(async (db) => {
    const response = randomUUID();
    await db.query(
      `insert into se_vezmou.rsvp_responses (id, wedding_id, household_id, answers)
       values ($1, $2, $3, '{"message": "Moc se těšíme!"}')`,
      [response, weddingId, household],
    );
    const guests = await db.query<{ id: string; display_name: string }>(
      "select id, display_name from se_vezmou.guests where household_id = $1",
      [household],
    );
    for (const guest of guests.rows) {
      const person = randomUUID();
      await db.query(
        "insert into se_vezmou.rsvp_people (id, wedding_id, response_id, guest_id, person_name) values ($1, $2, $3, $4, $5)",
        [person, weddingId, response, guest.id, guest.display_name],
      );
      await db.query(
        "insert into se_vezmou.rsvp_attendance (wedding_id, person_id, event_id, attending) values ($1, $2, $3, true)",
        [weddingId, person, events.reception],
      );
    }
    await db.query(
      "insert into se_vezmou.rsvp_updates (wedding_id, response_id, email, phone, locale) values ($1, $2, 'jan@example.test', '+420 777 123 456', 'cs')",
      [weddingId, response],
    );
    await db.query(
      `update se_vezmou.rsvp_settings set enabled_questions = '{"message": true, "updates": true}' where wedding_id = $1`,
      [weddingId],
    );
    await db.query(
      `insert into se_vezmou.gift_items (wedding_id, title, price) values ($1, '{"cs": "Mixér"}', '2 500 Kč'), ($1, '{"cs": "Deka"}', null)`,
      [weddingId],
    );
  });
}

test.describe("axe: funkce z plánu 2026-10 ve správě", () => {
  test("cedulka, odpovědi se vzkazy a upozorněním, zasedací pořádek, dary, poznámky", async ({
    page,
    context,
  }) => {
    const site = await seedSite({ tweak: enable });
    await seedAnswered(site.weddingId);
    await site.login(context);

    await page.goto(appUrl("/web/cedulka"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Cedulka s QR kódem galerie" }),
    ).toBeVisible();
    await expectNoViolations(page);

    await page.goto(appUrl("/odpovedi"));
    await expect(page.getByTestId("guest-messages")).toBeVisible();
    await page.getByRole("button", { name: "Odeslat upozornění" }).click();
    await expect(page.getByText("Napište text zprávy.")).toBeVisible();
    await expectNoViolations(page);

    await page.goto(appUrl("/hoste/zasedaci-poradek"));
    await page.getByRole("button", { name: "Vytvořit stoly" }).click();
    await expect(page.getByTestId("seating-map")).toBeVisible();
    await expect(page.getByText("Plán je uložený.")).toBeVisible();
    await expectNoViolations(page);
    await page.goto(appUrl("/hoste/zasedaci-poradek/tisk"));
    await expect(page.getByRole("heading", { level: 2, name: "Plánek sálu" })).toBeVisible();
    await expectNoViolations(page);

    await page.goto(appUrl("/dary"));
    await expect(page.getByTestId("gift-list")).toBeVisible();
    await page.getByRole("button", { name: "Přidat dar" }).last().click();
    await expect(page.getByText("Vyplňte název daru.")).toBeVisible();
    await expectNoViolations(page);

    await page.goto(appUrl("/poznamky"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Poznámky a dodavatelé" }),
    ).toBeVisible();
    await expectNoViolations(page);
  });
});

test.describe("axe: funkce z plánu 2026-10 na webu páru", () => {
  test("RSVP se vzkazem a upozorněním, seznam darů s rezervací, odhlášení upozornění", async ({
    page,
  }) => {
    const site = await seedSite({ tweak: enable });
    await seedAnswered(site.weddingId);

    await page.goto(site.url);
    const section = page.locator("#potvrdit-ucast");
    await section.getByLabel("Vaše jméno").fill("Jan Novák");
    await section.getByRole("button", { name: "Pokračovat" }).click();
    await expect(section.getByLabel("Vzkaz pro novomanžele")).toBeVisible();
    await expect(section.getByRole("group", { name: "Upozornění na změny" })).toBeVisible();
    await expect(page.getByTestId("registry-item").first()).toBeVisible();
    await page
      .locator(".site-registry")
      .getByRole("button", { name: "Zarezervovat: Mixér" })
      .click();
    await expect(page.getByLabel("Vaše jméno (nepovinné)")).toBeFocused();
    await expectNoViolations(page);

    await page.goto(tenantUrl(site.slug, `/upozorneni?t=${"a".repeat(36)}`));
    await expect(page.getByRole("button", { name: "Odhlásit upozornění" })).toBeVisible();
    await expectNoViolations(page);
  });
});
