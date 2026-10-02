import type { Page } from "@playwright/test";
import { HOSTS, PORT, pageUrl } from "./hosts";
import { uniqueTag, withDb } from "./support/db";
import { codeOf, linkOf, waitForMail } from "./support/mail";
import { expect, test } from "./support/fixtures";
import {
  admin,
  auditRows,
  grantGuestAccess,
  loginAsOperator,
  operatorSessions,
  passFirstFactor,
  seedManyWeddings,
  seedOperator,
  seedOpsWedding,
  type OpsWedding,
} from "./support/ops";

/**
 * Provozní administrace (M9): seznam zakázek s filtry a hledáním, detail, zásahy s auditem, role podpory
 * a majitele, nahlédnutí do údajů hostů jen se souhlasem, přehled, retence, audit a správa operátorů.
 * Po každé akci se čeká na viditelný výsledek (hlášení v živé oblasti), teprve potom test pokračuje.
 */

async function rows<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return withDb(async (db) => (await db.query<T>(sql, params)).rows);
}

const detailUrl = (wedding: OpsWedding) => admin(`/zakazky/${wedding.weddingId}`);

/** Karta zásahu podle nadpisu (sekce s `aria-labelledby` je oblast se jménem). */
const card = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

async function searchFor(page: Page, query: string) {
  await page.goto(admin(`/zakazky?q=${encodeURIComponent(query)}`));
  await expect(page.getByRole("heading", { level: 1, name: "Zakázky" })).toBeVisible();
}

/** Hlášení o provedeném zásahu (živá oblast mimo formulář). */
const banner = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

const summary = (page: Page) => page.getByRole("status").filter({ hasText: /Nalezen|Žádná/ });

test.describe("seznam zakázek", () => {
  test("filtry stavu, jazyka, šablony a měsíce a hledání (jména, adresa, e-mail správce)", async ({
    page,
  }) => {
    const operator = await seedOperator({ role: "support", enrolled: true });
    const base = uniqueTag();
    const a = await seedOpsWedding({
      tag: `${base}a`,
      status: "published",
      template: "editorial",
      locales: ["cs"],
      startsOn: "2031-06-12",
      guests: [`Hostitelka Tajná${base}`],
    });
    const b = await seedOpsWedding({
      tag: `${base}b`,
      status: "draft",
      template: "modern",
      locales: ["en", "cs"],
      startsOn: "2031-07-04",
    });
    const c = await seedOpsWedding({
      tag: `${base}c`,
      status: "blocked",
      template: "chateau",
      locales: ["en"],
      startsOn: "2031-06-20",
    });
    await loginAsOperator(page, operator);

    await page.getByRole("link", { name: "Zakázky", exact: true }).click();
    await page.waitForURL(admin("/zakazky"));
    await page.getByLabel("Hledat").fill(base);
    await page.getByRole("button", { name: "Použít filtry" }).click();
    await expect(summary(page)).toContainText(/Nalezeny\s3\szakázky/);
    const table = page.getByRole("table", { name: "Seznam zakázek" });
    for (const w of [a, b, c]) {
      await expect(table.getByRole("link", { name: w.names })).toBeVisible();
    }
    // hlavičky sloupců pro čtečky
    for (const heading of [
      "Pár",
      "Adresa",
      "Stav",
      "Datum svatby",
      "Šablona",
      "Jazyky",
      "Správců",
    ]) {
      await expect(table.getByRole("columnheader", { name: heading })).toBeVisible();
    }

    // stav
    await page.getByLabel("Stav", { exact: true }).selectOption({ label: "Zveřejněno" });
    await page.getByRole("button", { name: "Použít filtry" }).click();
    await expect(page).toHaveURL(/stav=published/);
    await expect(summary(page)).toContainText(/Nalezena\s1\szakázka/);
    await expect(table.getByRole("link", { name: a.names })).toBeVisible();
    await expect(table.getByRole("link", { name: b.names })).toHaveCount(0);

    // jazyk (vícejazyčná zakázka se počítá k oběma)
    await page.getByLabel("Stav", { exact: true }).selectOption({ label: "Vše" });
    await page.getByLabel("Jazyk webu").selectOption({ label: "Anglicky" });
    await page.getByRole("button", { name: "Použít filtry" }).click();
    await expect(page).toHaveURL(/jazyk=en/);
    await expect(summary(page)).toContainText(/Nalezeny\s2\szakázky/);
    await expect(table.getByRole("link", { name: a.names })).toHaveCount(0);

    // šablona
    await page.getByLabel("Jazyk webu").selectOption({ label: "Vše" });
    await page.getByLabel("Šablona", { exact: true }).selectOption({ label: "Château" });
    await page.getByRole("button", { name: "Použít filtry" }).click();
    await expect(page).toHaveURL(/sablona=chateau/);
    await expect(summary(page)).toContainText(/Nalezena\s1\szakázka/);
    await expect(table.getByRole("link", { name: c.names })).toBeVisible();

    // měsíc svatby
    await page.getByLabel("Šablona", { exact: true }).selectOption({ label: "Vše" });
    await page.getByLabel("Měsíc svatby").fill("2031-06");
    await page.getByRole("button", { name: "Použít filtry" }).click();
    await expect(page).toHaveURL(/mesic=2031-06/);
    await expect(summary(page)).toContainText(/Nalezeny\s2\szakázky/);
    await expect(table.getByRole("link", { name: b.names })).toHaveCount(0);

    // zrušení filtrů
    await page.getByRole("link", { name: "Zrušit filtry" }).click();
    await expect(page).toHaveURL(admin("/zakazky"));

    // hledání: jména bez diakritiky a velikosti písmen, adresa, e-mail správce
    await searchFor(page, `alzbeta${a.tag} CTIBOR${a.tag}`);
    await expect(summary(page)).toContainText(/Nalezena\s1\szakázka/);
    await searchFor(page, b.slug);
    await expect(summary(page)).toContainText(/Nalezena\s1\szakázka/);
    await expect(page.getByRole("link", { name: b.names })).toBeVisible();
    await searchFor(page, c.adminEmail);
    await expect(summary(page)).toContainText(/Nalezena\s1\szakázka/);
    await expect(page.getByRole("link", { name: c.names })).toBeVisible();

    // hledání nesmí prozradit údaje hostů
    await searchFor(page, `Tajná${base}`);
    await expect(summary(page)).toContainText(/Nalezeno\s0\szakázek/);
    await expect(page.getByText("Žádná zakázka neodpovídá filtrům.")).toBeVisible();
    await searchFor(page, `Hostitelka Tajná${base}`);
    await expect(page.getByText("Žádná zakázka neodpovídá filtrům.")).toBeVisible();
    await expect(page.getByText(`Tajná${base}`, { exact: false })).toHaveCount(0);
  });

  test("stránkování po 25 zakázkách", async ({ page }) => {
    const operator = await seedOperator({ role: "owner", enrolled: true });
    const base = uniqueTag();
    await seedManyWeddings(base, 27);
    await loginAsOperator(page, operator);
    await searchFor(page, base);

    await expect(summary(page)).toContainText(/Nalezeno\s27\szakázek/);
    const table = page.getByRole("table", { name: "Seznam zakázek" });
    await expect(table.getByRole("row")).toHaveCount(26); // hlavička a 25 řádků
    const nav = page.getByRole("navigation", { name: "Stránkování" });
    await expect(nav.getByText(/Strana\s1\sz\s2/)).toBeVisible();
    await expect(nav.getByRole("link", { name: "Předchozí strana" })).toHaveCount(0);

    await nav.getByRole("link", { name: "Další strana" }).click();
    await expect(page).toHaveURL(/strana=2/);
    await expect(nav.getByText(/Strana\s2\sz\s2/)).toBeVisible();
    await expect(table.getByRole("row")).toHaveCount(3); // hlavička a 2 řádky
    await expect(nav.getByRole("link", { name: "Další strana" })).toHaveCount(0);

    await nav.getByRole("link", { name: "Předchozí strana" }).click();
    await expect(nav.getByText(/Strana\s1\sz\s2/)).toBeVisible();
  });

  test("ručně upravená adresa s neplatnými filtry nic nerozbije", async ({ page }) => {
    const operator = await seedOperator({ role: "support", enrolled: true });
    await loginAsOperator(page, operator);
    const response = await page.goto(
      admin("/zakazky?stav=nic&jazyk=de&mesic=2030-13&strana=-5&sablona=x"),
    );
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Zakázky" })).toBeVisible();
  });
});

test.describe("detail zakázky", () => {
  test("jména, e-mail správce, adresa, šablona, jazyky, datum, historie, poznámky a odkaz na web", async ({
    page,
  }) => {
    const operator = await seedOperator({ role: "support", enrolled: true });
    const w = await seedOpsWedding({
      template: "chateau",
      locales: ["cs", "en"],
      startsOn: "2031-06-12",
    });
    await rows(
      "insert into se_vezmou.operator_notes (wedding_id, operator_id, body) values ($1, $2, 'Starší poznámka k zakázce')",
      [w.weddingId, operator.id],
    );
    await rows(
      "insert into se_vezmou.wedding_status_history (wedding_id, from_status, to_status, actor_type, reason) values ($1, 'draft', 'published', 'system', 'Zveřejněno párem')",
      [w.weddingId],
    );
    await loginAsOperator(page, operator);
    await searchFor(page, w.tag);
    await page.getByRole("link", { name: w.names }).click();
    await page.waitForURL(detailUrl(w));

    await expect(page).toHaveTitle(new RegExp(`Zakázka ${w.partnerA}`));
    await expect(page.getByRole("heading", { level: 1, name: `Zakázka ${w.names}` })).toBeVisible();
    const summaryBox = page.getByRole("region", { name: "Základní údaje" });
    await expect(summaryBox.getByText(w.slug, { exact: true })).toBeVisible();
    await expect(summaryBox.getByText("Zveřejněno", { exact: true }).first()).toBeVisible();
    await expect(summaryBox.getByText("Château", { exact: true })).toBeVisible();
    await expect(summaryBox.getByText("Česky, Anglicky")).toBeVisible();
    await expect(summaryBox.getByText(/12\.\s6\.\s2031/)).toBeVisible();
    await expect(summaryBox.getByText("Europe/Prague")).toBeVisible();

    const admins = page.getByRole("table", { name: "Správci zakázky" });
    await expect(admins.getByRole("rowheader", { name: w.adminEmail })).toBeVisible();
    await expect(admins.getByText("Aktivní")).toBeVisible();

    const history = page.getByRole("table", { name: "Změny stavu zakázky" });
    await expect(history.getByRole("cell", { name: "Zveřejněno párem" })).toBeVisible();
    await expect(history.getByRole("cell", { name: "systém" })).toBeVisible();

    await expect(page.getByText("Starší poznámka k zakázce")).toBeVisible();
    await expect(page.getByText(operator.email, { exact: false }).first()).toBeVisible();

    // odkaz na zveřejněný web míří na hostitele webu páru (nová karta, bez referreru)
    const link = page.getByRole("link", { name: /Otevřít zveřejněný web/ });
    await expect(link).toHaveAttribute("href", `http://${w.slug}.localhost:${PORT}`);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);

    // údaje hostů v detailu nejsou (jen počet)
    await expect(summaryBox.getByText("Počet hostů")).toBeVisible();
  });

  test("koncept nemá veřejný odkaz; neexistující a neplatný identifikátor je 404", async ({
    page,
  }) => {
    const operator = await seedOperator({ role: "support", enrolled: true });
    const w = await seedOpsWedding({ status: "draft" });
    await loginAsOperator(page, operator);
    await page.goto(detailUrl(w));
    await expect(page.getByText("Web zatím není zveřejněný.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Otevřít zveřejněný web/ })).toHaveCount(0);

    const missing = await page.goto(admin("/zakazky/00000000-0000-4000-8000-000000000000"));
    expect(missing?.status()).toBe(404);
    const invalid = await page.goto(admin("/zakazky/neni-uuid"));
    expect(invalid?.status()).toBe(404);
  });
});

test.describe("zásahy majitele", () => {
  test("změna stavu: zablokování a odblokování s historií, auditem a účinkem na veřejný web", async ({
    page,
  }) => {
    const operator = await seedOperator({ role: "owner", enrolled: true });
    const w = await seedOpsWedding();
    await loginAsOperator(page, operator);
    await page.goto(detailUrl(w));

    const status = card(page, "Změna stavu");
    // bez důvodu zásah neprojde a chyba je slovy u pole
    await status.getByLabel("Nový stav").selectOption({ label: "Zablokováno" });
    await status.getByRole("button", { name: "Změnit stav" }).click();
    await expect(status.getByLabel("Důvod")).toHaveAttribute("aria-invalid", "true");
    await expect(status.getByText("Vyplňte důvod.")).toBeVisible();
    expect(
      (await rows("select status from se_vezmou.weddings where id = $1", [w.weddingId]))[0],
    ).toEqual({
      status: "published",
    });

    await status.getByLabel("Důvod").fill("Hlášení zneužití č. 17");
    await status.getByRole("button", { name: "Změnit stav" }).click();
    await expect(banner(page, "Stav webu byl změněn.")).toBeVisible();

    // historie na stránce, v databázi i v auditu; zablokovaný web páru vrací neutrální 404
    const history = page.getByRole("table", { name: "Změny stavu zakázky" });
    await expect(history.getByRole("cell", { name: "Hlášení zneužití č. 17" })).toBeVisible();
    expect(
      (
        await rows(
          "select status, blocked_at is not null as b from se_vezmou.weddings where id = $1",
          [w.weddingId],
        )
      )[0],
    ).toEqual({ status: "blocked", b: true });
    const audit = await auditRows("wedding_id = $1 and action = 'wedding.status_change'", [
      w.weddingId,
    ]);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_type: "operator",
      actor_id: operator.id,
      reason: "Hlášení zneužití č. 17",
      meta: { from_status: "published", to_status: "blocked" },
    });
    const tenant = await page.request.get(`http://127.0.0.1:${PORT}/`, {
      headers: { host: `${w.slug}.localhost:${PORT}` },
    });
    expect(tenant.status()).toBe(404);

    // odblokování
    await status.getByLabel("Nový stav").selectOption({ label: "Zveřejněno" });
    await status.getByLabel("Důvod").fill("Hlášení se nepotvrdilo");
    await status.getByRole("button", { name: "Změnit stav" }).click();
    await expect(history.getByRole("cell", { name: "Hlášení se nepotvrdilo" })).toBeVisible();
    expect(
      (await rows("select status from se_vezmou.weddings where id = $1", [w.weddingId]))[0],
    ).toEqual({ status: "published" });
    expect(
      await auditRows("wedding_id = $1 and action = 'wedding.status_change'", [w.weddingId]),
    ).toHaveLength(2);
  });

  test("změna adresy: obsazená adresa se odmítne, nová se přidělí a stará zůstane trvale zablokovaná", async ({
    page,
  }) => {
    const operator = await seedOperator({ role: "owner", enrolled: true });
    const w = await seedOpsWedding();
    const other = await seedOpsWedding();
    await loginAsOperator(page, operator);
    await page.goto(detailUrl(w));
    const slug = card(page, "Změna adresy webu");

    await slug.getByLabel("Nová adresa").fill(other.slug);
    await slug.getByLabel("Důvod").fill("Přání páru");
    await slug.getByRole("button", { name: "Změnit adresu" }).click();
    await expect(slug.getByLabel("Nová adresa")).toHaveAttribute("aria-invalid", "true");
    await expect(slug.getByText("Tato adresa je obsazená nebo zakázaná.")).toBeVisible();

    await slug.getByLabel("Nová adresa").fill("Špatná adresa!");
    await slug.getByRole("button", { name: "Změnit adresu" }).click();
    await expect(slug.getByText(/Adresa smí obsahovat jen malá písmena/)).toBeVisible();

    const fresh = `nova-${w.tag}`;
    await slug.getByLabel("Nová adresa").fill(fresh);
    await slug.getByRole("button", { name: "Změnit adresu" }).click();
    await expect(banner(page, "Adresa webu byla změněna.")).toBeVisible();
    const link = page.getByRole("link", { name: /Otevřít zveřejněný web/ });
    await expect(link).toHaveAttribute("href", `http://${fresh}.localhost:${PORT}`);

    const registry = await rows<{ slug: string; state: string }>(
      "select slug, state from se_vezmou.slug_registry where wedding_id = $1 order by slug",
      [w.weddingId],
    );
    expect(registry).toEqual(
      expect.arrayContaining([
        { slug: fresh, state: "active" },
        { slug: w.slug, state: "retired" },
      ]),
    );
    const audit = await auditRows("wedding_id = $1 and action = 'wedding.slug_change'", [
      w.weddingId,
    ]);
    expect(audit).toHaveLength(1);
    expect(audit[0].meta).toEqual({ old_slug: w.slug, new_slug: fresh });

    // stará zveřejněná adresa se nepřidělí nikomu dalšímu
    await page.goto(detailUrl(other));
    const otherSlug = card(page, "Změna adresy webu");
    await otherSlug.getByLabel("Nová adresa").fill(w.slug);
    await otherSlug.getByLabel("Důvod").fill("Zkouška převzetí");
    await otherSlug.getByRole("button", { name: "Změnit adresu" }).click();
    await expect(otherSlug.getByText("Tato adresa je obsazená nebo zakázaná.")).toBeVisible();
  });

  test("prodloužení provozu: jen prodloužit, ne zkrátit; zapíše se do auditu", async ({ page }) => {
    const operator = await seedOperator({ role: "owner", enrolled: true });
    const w = await seedOpsWedding({ serviceEndsAt: "2032-01-31T12:00:00Z" });
    await loginAsOperator(page, operator);
    await page.goto(detailUrl(w));
    const extend = card(page, "Prodloužení lhůty");

    await extend.getByLabel("Co prodloužit").selectOption({ label: "Provoz webu" });
    await extend.getByLabel("Nové datum").fill("2031-12-01");
    await extend.getByLabel("Důvod").fill("Zkrácení");
    await extend.getByRole("button", { name: "Prodloužit" }).click();
    await expect(extend.getByLabel("Nové datum")).toHaveAttribute("aria-invalid", "true");
    await expect(extend.getByText(/Lhůtu jde jen prodloužit: nové datum/)).toBeVisible();

    await extend.getByLabel("Nové datum").fill("2033-03-15");
    await extend.getByLabel("Důvod").fill("Prodloužení o rok");
    await extend.getByRole("button", { name: "Prodloužit" }).click();
    await expect(banner(page, "Lhůta byla prodloužena.")).toBeVisible();
    const [order] = await rows<{ ends: string }>(
      "select to_char(service_ends_at at time zone 'Europe/Prague', 'YYYY-MM-DD HH24:MI') as ends from se_vezmou.orders where wedding_id = $1",
      [w.weddingId],
    );
    expect(order.ends).toBe("2033-03-16 00:00");
    const audit = await auditRows("wedding_id = $1 and action = 'wedding.retention_extend'", [
      w.weddingId,
    ]);
    expect(audit).toHaveLength(1);
    expect(audit[0].meta).toMatchObject({ kind: "service" });
    expect(audit[0].reason).toBe("Prodloužení o rok");
  });

  test("smazání a obnova v ochranné lhůtě", async ({ page }) => {
    const operator = await seedOperator({ role: "owner", enrolled: true });
    const w = await seedOpsWedding();
    await loginAsOperator(page, operator);
    await page.goto(detailUrl(w));
    await expect(page.getByRole("region", { name: "Obnovení smazaného webu" })).toHaveCount(0);

    const status = card(page, "Změna stavu");
    await status.getByLabel("Nový stav").selectOption({ label: "Smazáno" });
    await status.getByLabel("Důvod").fill("Žádost páru o smazání");
    await status.getByRole("button", { name: "Změnit stav" }).click();

    const restore = card(page, "Obnovení smazaného webu");
    await expect(restore).toBeVisible();
    await expect(restore.getByText(/Smazaný web jde obnovit do/)).toBeVisible();
    expect(
      (
        await rows(
          "select status, purge_at is not null as p from se_vezmou.weddings where id = $1",
          [w.weddingId],
        )
      )[0],
    ).toEqual({ status: "deleted", p: true });

    await restore.getByRole("button", { name: "Obnovit web" }).click();
    await expect(restore.getByLabel("Důvod")).toHaveAttribute("aria-invalid", "true");
    await restore.getByLabel("Důvod").fill("Smazáno omylem");
    await restore.getByRole("button", { name: "Obnovit web" }).click();
    await expect(banner(page, "Web byl obnoven.")).toBeVisible();
    await expect(card(page, "Obnovení smazaného webu")).toHaveCount(0);
    expect(
      (
        await rows("select status, purge_at is null as p from se_vezmou.weddings where id = $1", [
          w.weddingId,
        ])
      )[0],
    ).toEqual({ status: "published", p: true });
    expect(
      await auditRows("wedding_id = $1 and action = 'wedding.restore'", [w.weddingId]),
    ).toHaveLength(1);

    // po uplynutí ochranné lhůty už obnova nejde
    await withDb(async (db) => {
      await db.query(
        "update se_vezmou.weddings set status = 'deleted', purge_at = now() - interval '1 minute' where id = $1",
        [w.weddingId],
      );
    });
    await page.goto(detailUrl(w));
    await expect(page.getByRole("region", { name: "Obnovení smazaného webu" })).toHaveCount(0);
  });

  test("poznámka k zakázce se ukáže se jménem autora a zapíše do auditu bez textu", async ({
    page,
  }) => {
    const operator = await seedOperator({ role: "owner", enrolled: true });
    const w = await seedOpsWedding();
    await loginAsOperator(page, operator);
    await page.goto(detailUrl(w));
    const note = card(page, "Nová poznámka");
    await note.getByRole("button", { name: "Přidat poznámku" }).click();
    await expect(note.getByLabel("Poznámka")).toHaveAttribute("aria-invalid", "true");
    await note.getByLabel("Poznámka").fill("Pár chce web v květnu.\nVolat ve čtvrtek.");
    await note.getByRole("button", { name: "Přidat poznámku" }).click();
    await expect(banner(page, "Poznámka byla přidána.")).toBeVisible();
    await expect(page.getByText("Pár chce web v květnu.", { exact: false })).toBeVisible();
    const audit = await auditRows("wedding_id = $1 and action = 'wedding.note_add'", [w.weddingId]);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("květnu");
  });

  test("serverová kontrola role: majitel, kterému mezitím odebrali roli, už adresu nezmění", async ({
    page,
  }) => {
    const operator = await seedOperator({ role: "owner", enrolled: true });
    const w = await seedOpsWedding();
    await loginAsOperator(page, operator);
    await page.goto(detailUrl(w));
    const slug = card(page, "Změna adresy webu");
    await expect(slug).toBeVisible();

    // role se změní po vykreslení formuláře (formulář stále v prohlížeči)
    await rows("update se_vezmou.operators set role = 'support' where id = $1", [operator.id]);
    await slug.getByLabel("Nová adresa").fill(`stolen-${w.tag}`);
    await slug.getByLabel("Důvod").fill("Pokus bez oprávnění");
    await slug.getByRole("button", { name: "Změnit adresu" }).click();
    await expect(slug.getByText("Na tento zásah nemáte oprávnění.")).toBeVisible();
    expect(
      (await rows("select slug from se_vezmou.weddings where id = $1", [w.weddingId]))[0],
    ).toEqual({ slug: w.slug });
    expect(
      await auditRows("wedding_id = $1 and action = 'wedding.slug_change'", [w.weddingId]),
    ).toHaveLength(0);
  });
});

test.describe("zásahy podpory", () => {
  test("podpora smí web jen zablokovat a nevidí zásahy majitele, audit ani správu operátorů", async ({
    page,
  }) => {
    const operator = await seedOperator({ role: "support", enrolled: true });
    const w = await seedOpsWedding();
    await loginAsOperator(page, operator);

    // nabídka bez Auditu a Operátorů
    const nav = page.getByRole("navigation", { name: "Hlavní nabídka provozní administrace" });
    await expect(nav.getByRole("link", { name: "Zakázky" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Audit" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Operátoři" })).toHaveCount(0);
    for (const path of ["/audit", "/operatori"]) {
      await page.goto(admin(path));
      await expect(page, path).toHaveURL(admin("/"));
    }

    await page.goto(detailUrl(w));
    for (const name of ["Změna adresy webu", "Prodloužení lhůty", "Obnovení smazaného webu"]) {
      await expect(page.getByRole("region", { name })).toHaveCount(0);
    }
    await expect(page.getByText(/dělá jen majitel/)).toBeVisible();

    const status = card(page, "Změna stavu");
    const options = await status.getByLabel("Nový stav").locator("option").allInnerTexts();
    expect(options).toEqual(["Zablokováno"]);
    await status.getByLabel("Důvod").fill("Podezření na zneužití");
    await status.getByRole("button", { name: "Změnit stav" }).click();
    await expect(banner(page, "Stav webu byl změněn.")).toBeVisible();
    expect(
      (await rows("select status from se_vezmou.weddings where id = $1", [w.weddingId]))[0],
    ).toEqual({ status: "blocked" });

    // odblokovat podpora nemůže (zablokovanou zakázku už nelze měnit)
    await expect(status.getByLabel("Nový stav")).toHaveCount(0);
    await expect(status.getByText(/podpora smí web jen zablokovat/).first()).toBeVisible();
    const audit = await auditRows("wedding_id = $1 and action = 'wedding.status_change'", [
      w.weddingId,
    ]);
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_id).toBe(operator.id);
  });
});

test.describe("přihlašovací odkaz správci", () => {
  test("podpora pošle správci kód a odkaz; správce se jím přihlásí do správy páru; audit bez e-mailu", async ({
    page,
  }) => {
    const operator = await seedOperator({ role: "support", enrolled: true });
    const w = await seedOpsWedding();
    await loginAsOperator(page, operator);
    await page.goto(detailUrl(w));
    const link = card(page, "Přihlašovací odkaz správci");
    await link.getByLabel("Správce").selectOption({ label: w.adminEmail });
    await link.getByRole("button", { name: "Poslat odkaz" }).click();
    await expect(banner(page, "Přihlašovací odkaz byl odeslán správci.")).toBeVisible();

    const mail = await waitForMail(w.adminEmail);
    expect(mail.subject).toBe("Váš přihlašovací kód do správy svatby");
    expect(codeOf(mail)).toMatch(/^\d{6}$/);
    const url = linkOf(mail);
    expect(new URL(url).host).toBe(`app.localhost:${PORT}`);

    const audit = await auditRows("wedding_id = $1 and action = 'wedding.login_link_sent'", [
      w.weddingId,
    ]);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: operator.id, target_id: w.adminId });
    expect(JSON.stringify(audit)).not.toContain(w.adminEmail);

    // odkaz nejdřív ukáže potvrzení a teprve potom přihlásí
    await page.goto(url);
    await expect(
      page.getByRole("heading", { level: 1, name: "Potvrďte přihlášení" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Přihlásit se" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Správa svatby" })).toBeVisible();
    await expect(page).toHaveURL(pageUrl(HOSTS.app, "/"));
  });

  test("zablokované zakázce se odkaz neposílá", async ({ page }) => {
    const operator = await seedOperator({ role: "support", enrolled: true });
    const w = await seedOpsWedding({ status: "blocked" });
    await loginAsOperator(page, operator);
    await page.goto(detailUrl(w));
    const link = card(page, "Přihlašovací odkaz správci");
    await expect(link.getByText("Zakázka nemá žádného aktivního správce.")).toBeVisible();
    await expect(link.getByRole("button", { name: "Poslat odkaz" })).toHaveCount(0);
  });
});

test.describe("nahlédnutí do údajů hostů", () => {
  test("výchozí stav bez přístupu: bez souhlasu páru nic nevrátí a odmítnutí je v auditu s důvodem", async ({
    page,
  }) => {
    const operator = await seedOperator({ role: "owner", enrolled: true });
    const w = await seedOpsWedding({ guests: [`Anežka Nováková${uniqueTag()}`] });
    await loginAsOperator(page, operator);
    await page.goto(detailUrl(w));

    const guests = page.getByRole("region", { name: "Údaje hostů" });
    await expect(guests.getByText(/Pár nyní nedal souhlas s\snahlédnutím/)).toBeVisible();
    // údaje hostů nejsou v detailu ani v HTML
    expect(await page.content()).not.toContain("Nováková");

    await guests.getByRole("button", { name: "Zobrazit údaje hostů" }).click();
    await expect(guests.getByLabel("Důvod nahlédnutí")).toHaveAttribute("aria-invalid", "true");
    await guests.getByLabel("Důvod nahlédnutí").fill("Pomoc s importem hostů");
    await guests.getByRole("button", { name: "Zobrazit údaje hostů" }).click();
    await expect(guests.getByText(/Přístup byl odmítnut/)).toBeVisible();
    await expect(guests.getByRole("table")).toHaveCount(0);
    expect(await page.content()).not.toContain("Nováková");

    const denied = await auditRows("wedding_id = $1 and action = 'guest_data.view_denied'", [
      w.weddingId,
    ]);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ actor_id: operator.id, reason: "Pomoc s importem hostů" });
    expect(
      await auditRows("wedding_id = $1 and action = 'guest_data.view'", [w.weddingId]),
    ).toHaveLength(0);
  });

  test("se souhlasem páru podpora i majitel hosty vidí, s důvodem a záznamem do auditu", async ({
    page,
  }) => {
    const operator = await seedOperator({ role: "support", enrolled: true });
    const guestName = `Marie Svobodová${uniqueTag()}`;
    const w = await seedOpsWedding({ guests: [guestName, `Petr Svoboda${uniqueTag()}`] });
    await grantGuestAccess(w);
    await loginAsOperator(page, operator);
    await page.goto(detailUrl(w));

    const guests = page.getByRole("region", { name: "Údaje hostů" });
    await expect(guests.getByText(/Souhlas páru platí do/)).toBeVisible();
    await guests.getByLabel("Důvod nahlédnutí").fill("Oprava jmen na žádost páru");
    await guests.getByRole("button", { name: "Zobrazit údaje hostů" }).click();
    const table = guests.getByRole("table", {
      name: /Údaje hostů, viditelné jen po dobu souhlasu/,
    });
    await expect(table.getByRole("rowheader", { name: guestName })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Domácnost" })).toBeVisible();

    const viewed = await auditRows("wedding_id = $1 and action = 'guest_data.view'", [w.weddingId]);
    expect(viewed).toHaveLength(1);
    expect(viewed[0]).toMatchObject({
      actor_id: operator.id,
      reason: "Oprava jmen na žádost páru",
    });
    expect(viewed[0].meta).toEqual({ guests: 2 });
    expect(JSON.stringify(viewed)).not.toContain("Svobod");

    // souhlas, který vypršel, přístup zase zavře
    await withDb((db) =>
      db.query(
        "update se_vezmou.data_access_grants set created_at = now() - interval '2 days', expires_at = now() - interval '1 minute' where wedding_id = $1",
        [w.weddingId],
      ),
    );
    await page.goto(detailUrl(w));
    await expect(page.getByText(/Pár nyní nedal souhlas s\snahlédnutím/)).toBeVisible();
    await guests.getByLabel("Důvod nahlédnutí").fill("Po vypršení souhlasu");
    await guests.getByRole("button", { name: "Zobrazit údaje hostů" }).click();
    await expect(guests.getByText(/Přístup byl odmítnut/)).toBeVisible();
    await expect(guests.getByRole("table")).toHaveCount(0);
  });
});

test.describe("přehled, retence, audit, operátoři a účet", () => {
  test("přehled ukáže počty podle stavu, měsíců, šablon a jazyků a souhrn měření bez osobních údajů", async ({
    page,
  }) => {
    const operator = await seedOperator({ role: "support", enrolled: true });
    await seedOpsWedding({ status: "published", startsOn: "2034-09-10" });
    await seedOpsWedding({ status: "draft", startsOn: "2034-09-11" });
    await withDb((db) =>
      db.query(
        "insert into se_vezmou.analytics_event (event, locale, step) values ('wizard_step_completed', 'cs', 3), ('wizard_started', 'cs', null)",
      ),
    );
    await loginAsOperator(page, operator);

    const status = page.getByRole("table", { name: "Zakázky podle stavu" });
    for (const name of ["Koncept", "Zveřejněno", "Zablokováno", "Smazáno"]) {
      await expect(status.getByRole("rowheader", { name })).toBeVisible();
    }
    const months = page.getByRole("table", { name: "Svatby podle měsíce konání" });
    const september = months.getByRole("row", { name: /září 2034/ });
    await expect(september).toBeVisible();
    expect(Number(await september.getByRole("cell").innerText())).toBeGreaterThanOrEqual(2);
    await expect(page.getByRole("table", { name: "Podle šablony" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Podle jazyka webu" })).toBeVisible();
    const events = page.getByRole("table", { name: /Průvodce a zveřejnění za posledních/ });
    await expect(events.getByRole("rowheader", { name: "Průvodce zahájen" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Dokončené kroky průvodce" })).toBeVisible();
    // měření je bez identity: v přehledu není žádný e-mail
    expect(await page.getByRole("main").innerText()).not.toMatch(/@/);
  });

  test("lhůty a retence: smazaný web před trvalým smazáním je v seznamu s termínem, úlohy mají vlastní tabulku", async ({
    page,
  }) => {
    const operator = await seedOperator({ role: "support", enrolled: true });
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const later = new Date(Date.now() + 400 * 86_400_000).toISOString();
    const a = await seedOpsWedding({ status: "deleted" });
    const b = await seedOpsWedding({ status: "deleted" });
    await rows("update se_vezmou.weddings set purge_at = $2 where id = $1", [a.weddingId, soon]);
    await rows("update se_vezmou.weddings set purge_at = $2 where id = $1", [b.weddingId, later]);
    await loginAsOperator(page, operator);
    await page.getByRole("link", { name: "Lhůty a retence" }).click();
    await page.waitForURL(admin("/retence"));
    await expect(page.getByRole("heading", { level: 1, name: "Lhůty a retence" })).toBeVisible();
    const table = page.getByRole("table", { name: "Blížící se lhůty" });
    const row = table.getByRole("row", { name: new RegExp(a.partnerA) });
    await expect(row.getByRole("cell", { name: "Trvalé smazání webu" })).toBeVisible();
    await expect(row.getByRole("link", { name: a.names })).toHaveAttribute(
      "href",
      `/zakazky/${a.weddingId}`,
    );
    await expect(table.getByRole("row", { name: new RegExp(b.partnerA) })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Plánované úlohy" })).toBeVisible();
    // seznam nic nemaže
    expect(
      (
        await rows("select count(*)::int as n from se_vezmou.weddings where id = any($1)", [
          [a.weddingId, b.weddingId],
        ])
      )[0],
    ).toEqual({ n: 2 });
  });

  test("audit (jen majitel) s filtrem podle akce, zakázky a operátora", async ({ page }) => {
    const owner = await seedOperator({ role: "owner", enrolled: true });
    const w = await seedOpsWedding();
    await loginAsOperator(page, owner);
    await page.goto(detailUrl(w));
    const status = card(page, "Změna stavu");
    await status.getByLabel("Nový stav").selectOption({ label: "Archivováno" });
    await status.getByLabel("Důvod").fill("Archivace po svatbě");
    await status.getByRole("button", { name: "Změnit stav" }).click();
    await expect(banner(page, "Stav webu byl změněn.")).toBeVisible();

    await page
      .getByRole("navigation", { name: "Hlavní nabídka provozní administrace" })
      .getByRole("link", { name: "Audit" })
      .click();
    await page.waitForURL(admin("/audit"));
    await expect(page.getByRole("heading", { level: 1, name: "Audit" })).toBeVisible();

    await page.getByLabel("Akce (začátek názvu)").fill("wedding.status");
    await page.getByLabel("Zakázka (identifikátor)").fill(w.weddingId);
    await page.getByLabel("Operátor", { exact: true }).selectOption({ label: owner.email });
    await page.getByRole("button", { name: "Použít filtry" }).click();
    await expect(page).toHaveURL(/akce=wedding.status/);
    const table = page.getByRole("table", { name: "Záznamy auditu" });
    await expect(table.getByRole("row")).toHaveCount(2); // hlavička a jediný záznam
    const row = table.getByRole("row").nth(1);
    await expect(row.getByRole("cell", { name: "wedding.status_change" })).toBeVisible();
    await expect(row.getByRole("cell", { name: owner.email })).toBeVisible();
    await expect(row.getByRole("cell", { name: "Archivace po svatbě" })).toBeVisible();
    await expect(row.getByText(/"to_status":"archived"/)).toBeVisible();
    await expect(page.getByText(/Nalezen\s1\száznam/)).toBeVisible();

    // neplatný identifikátor zakázky se hlásí slovy
    await page.getByLabel("Zakázka (identifikátor)").fill("neni-uuid");
    await page.getByRole("button", { name: "Použít filtry" }).click();
    await expect(page.getByText("Identifikátor zakázky má tvar UUID.")).toBeVisible();
  });

  test("správa operátorů: založení, zakázání (ukončí relace) a obnova druhého faktoru", async ({
    page,
  }) => {
    const owner = await seedOperator({ role: "owner", enrolled: true });
    const target = await seedOperator({ role: "support", enrolled: true });
    await loginAsOperator(page, owner);
    await page.goto(admin("/operatori"));
    await expect(page.getByRole("heading", { level: 1, name: "Operátoři" })).toBeVisible();

    // relace cílového operátora (druhý prohlížeč)
    const context2 = await page
      .context()
      .browser()!
      .newContext({
        locale: "cs-CZ",
        extraHTTPHeaders: { "x-forwarded-for": "198.51.100.77" },
      });
    const page2 = await context2.newPage();
    await loginAsOperator(page2, target);

    const created = `novy-${uniqueTag()}@example.test`;
    const create = card(page, "Přidat operátora");
    await create.getByLabel("E-mail operátora").fill(created);
    await create.getByLabel("Role").selectOption({ label: "podpora" });
    await create.getByRole("button", { name: "Přidat operátora" }).click();
    await expect(create.getByText(/Operátor byl založen/)).toBeVisible();
    await expect(
      page
        .getByRole("table", { name: "Seznam operátorů" })
        .getByRole("rowheader", { name: created }),
    ).toBeVisible();
    await create.getByLabel("E-mail operátora").fill(created);
    await create.getByRole("button", { name: "Přidat operátora" }).click();
    await expect(create.getByText("Operátor s tímto e-mailem už existuje.")).toBeVisible();
    expect(
      await auditRows("action = 'operator.create' and actor_id = $1", [owner.id]),
    ).toHaveLength(1);

    // obnova druhého faktoru
    const reset = card(page, "Obnovit druhý faktor");
    await reset.getByLabel("Operátor").selectOption({ label: target.email });
    await reset.getByLabel("Důvod").fill("Ztracený telefon");
    await reset.getByRole("button", { name: "Obnovit druhý faktor" }).click();
    await expect(reset.getByText(/Druhý faktor byl zneplatněn/)).toBeVisible();
    const [mfa] = await rows<{ c: boolean; codes: number }>(
      "select (totp_confirmed_at is null and totp_secret_enc is null) as c, (select count(*)::int from se_vezmou.operator_backup_codes where operator_id = $1) as codes from se_vezmou.operators where id = $1",
      [target.id],
    );
    expect(mfa).toEqual({ c: true, codes: 0 });
    await page2.goto(admin("/zakazky"));
    await expect(page2).toHaveURL(admin("/prihlaseni"));

    // zakázání a povolení
    const disable = card(page, "Zakázat nebo povolit operátora");
    await disable.getByLabel("Operátor", { exact: true }).selectOption({ label: target.email });
    await disable.getByLabel("Co udělat").selectOption({ label: "Zakázat (ukončí jeho relace)" });
    await disable.getByLabel("Důvod").fill("Odchod z týmu");
    await disable.getByRole("button", { name: "Provést" }).click();
    await expect(disable.getByText(/Operátor byl zakázán/)).toBeVisible();
    expect(
      (
        await rows("select disabled_at is not null as d from se_vezmou.operators where id = $1", [
          target.id,
        ])
      )[0],
    ).toEqual({ d: true });
    expect((await operatorSessions(target.id)).every((s) => s.revoked_at !== null)).toBe(true);
    await expect(
      page
        .getByRole("table", { name: "Seznam operátorů" })
        .getByRole("row", { name: new RegExp(target.email) }),
    ).toContainText("zakázán");

    await disable.getByLabel("Co udělat").selectOption({ label: "Povolit" });
    await disable.getByLabel("Důvod").fill("Návrat do týmu");
    await disable.getByRole("button", { name: "Provést" }).click();
    await expect(disable.getByText("Operátor byl povolen.")).toBeVisible();

    // sebe majitel v nabídce nemá (zásah u sebe nejde)
    const options = await disable
      .getByLabel("Operátor", { exact: true })
      .locator("option")
      .allInnerTexts();
    expect(options).not.toContain(owner.email);
    await context2.close();
  });

  test("účet: nová sada záložních kódů zneplatní starou a nový kód funguje", async ({ page }) => {
    const operator = await seedOperator({ role: "support", enrolled: true });
    const [oldCode] = operator.backupCodes;
    await loginAsOperator(page, operator);
    await page.getByRole("link", { name: "Můj účet" }).click();
    await page.waitForURL(admin("/ucet"));
    await expect(page.getByRole("definition").filter({ hasText: operator.email })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: /^10$/ })).toBeVisible();

    await page.getByRole("button", { name: "Vytvořit nové kódy" }).click();
    await expect(page.getByRole("heading", { name: "Nové záložní kódy" })).toBeVisible();
    const codes = await page
      .getByRole("list", { name: "Záložní kódy" })
      .getByRole("listitem")
      .allInnerTexts();
    expect(codes).toHaveLength(10);
    expect(codes).not.toContain(oldCode);
    expect(
      await auditRows("action = 'operator.backup_codes_regenerated' and actor_id = $1", [
        operator.id,
      ]),
    ).toHaveLength(1);

    await page.getByRole("button", { name: "Odhlásit se" }).click();
    await page.waitForURL(admin("/prihlaseni"));
    // starý kód neplatí
    await passFirstFactor(page, operator);
    await page.getByLabel("Kód z aplikace nebo záložní kód").fill(oldCode);
    await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
    await expect(page.getByText(/Kód nesouhlasí nebo už byl použit/)).toBeVisible();
    await page.getByLabel("Kód z aplikace nebo záložní kód").fill(codes[0]);
    await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
    await page.waitForURL(admin("/"));
  });
});

test.describe("ruční přepsání fáze webu (M10)", () => {
  test("podpora přepíše fázi s důvodem a auditem, a přepsání zruší", async ({ page }) => {
    const operator = await seedOperator({ role: "support", enrolled: true });
    const w = await seedOpsWedding();
    await loginAsOperator(page, operator);
    await page.goto(detailUrl(w));
    const phase = card(page, "Ruční přepsání fáze webu");
    await phase.getByLabel("Fáze").selectOption({ label: "Poděkování" });
    await phase.getByRole("button", { name: "Uložit fázi" }).click();
    await expect(phase.getByLabel("Důvod")).toHaveAttribute("aria-invalid", "true");
    await phase.getByLabel("Důvod").fill("Svatba proběhla dříve");
    await phase.getByRole("button", { name: "Uložit fázi" }).click();
    await expect(banner(page, "Fáze webu byla uložena.")).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: "Poděkování" })).toBeVisible();
    expect(
      (await rows("select phase_override from se_vezmou.weddings where id = $1", [w.weddingId]))[0],
    ).toEqual({ phase_override: "thanks" });
    expect(
      await auditRows("wedding_id = $1 and action = 'wedding.phase_override'", [w.weddingId]),
    ).toHaveLength(1);

    await phase.getByLabel("Fáze").selectOption({ label: "Bez přepsání (podle dat svatby)" });
    await phase.getByLabel("Důvod").fill("Zrušeno");
    await phase.getByRole("button", { name: "Uložit fázi" }).click();
    await expect(page.getByRole("definition").filter({ hasText: "Poděkování" })).toHaveCount(0);
    expect(
      (await rows("select phase_override from se_vezmou.weddings where id = $1", [w.weddingId]))[0],
    ).toEqual({ phase_override: null });
  });
});
