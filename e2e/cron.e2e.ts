import { expect, test } from "@playwright/test";
import { hmac } from "../src/auth/crypto";
import { withDb } from "./support/db";
import { readMails, waitForMail } from "./support/mail";
import { E2E_SECRETS } from "./support/env";
import {
  auditOf,
  callCron,
  emailLogOf,
  lifecycleNotices,
  markDeleted,
  runJobAt,
  seedLifecycleWedding,
  weddingState,
} from "./support/lifecycle-db";

/**
 * Plánované úlohy (M10, E2E-22 a E2E-23): autorizace cest `/api/cron/*`, simulovaný průběh času bez čekání
 * (testovací hodina `now` jen v testovacím prostředí a jen pro jednu svatbu), upozornění před smazáním
 * v outboxu, retenční mazání po lhůtě, trvalé smazání webu a audit bez osobních údajů.
 * Po každém kroku se čeká na viditelný výsledek (e-mail v outboxu, stav v databázi), než se jde dál.
 */

const ROUTES = ["daily", "lifecycle", "retention", "housekeeping", "blog"] as const;

test.describe("autorizace cronu", () => {
  for (const route of ROUTES) {
    test(`/api/cron/${route}: bez hlavičky a se špatnou tajnou hodnotou 401`, async ({
      request,
    }) => {
      const without = await callCron(request, `/api/cron/${route}`, { authorization: null });
      expect(without.status).toBe(401);
      expect(without.body).toEqual({ error: "unauthorized" });

      const wrong = await callCron(request, `/api/cron/${route}`, {
        authorization: "Bearer spatna-tajna-hodnota-spatna-tajna-hodnota",
      });
      expect(wrong.status).toBe(401);

      const post = await callCron(request, `/api/cron/${route}`, {
        authorization: null,
        method: "POST",
      });
      expect(post.status).toBe(401);

      const bare = await callCron(request, `/api/cron/${route}`, {
        authorization: E2E_SECRETS.CRON_SECRET,
      });
      expect(bare.status, "tajná hodnota bez schématu Bearer").toBe(401);
    });
  }

  // Ostrý běh by načítal stránky produkčního webu (NEXT_PUBLIC_SITE_URL), proto jen dry_run.
  test("/api/cron/blog: dry_run spočítá dnešní články a nic nenačte", async ({ request }) => {
    const result = await callCron(request, "/api/cron/blog", { query: { dry_run: "1" } });
    expect(result.status).toBe(200);
    expect(result.body.dry_run).toBe(true);
    const report = result.body.jobs?.find((job) => job.job === "blog_publish");
    expect(report?.status).toBe("dry_run");
    expect(report?.counts).toMatchObject({ ready: 0, not_ready: 0 });
  });

  test("simulovaný čas bez tajné hodnoty se neprovede (a nic se nezmění)", async ({ request }) => {
    const wedding = await seedLifecycleWedding("2030-06-15");
    const before = await weddingState(wedding.weddingId, wedding.slug);
    const result = await callCron(request, "/api/cron/retention", {
      authorization: null,
      query: { wedding_id: wedding.weddingId, now: "2040-01-01T00:00:00Z" },
    });
    expect(result.status).toBe(401);
    expect(await weddingState(wedding.weddingId, wedding.slug)).toEqual(before);
  });

  test("se správnou tajnou hodnotou a dry_run vrátí počty a nic nezmění", async ({ request }) => {
    const wedding = await seedLifecycleWedding("2030-06-15");
    const before = await weddingState(wedding.weddingId, wedding.slug);
    const result = await callCron(request, "/api/cron/retention", {
      query: { dry_run: "1", wedding_id: wedding.weddingId, now: "2032-01-01T12:00:00Z" },
    });
    expect(result.status).toBe(200);
    expect(result.body.dry_run).toBe(true);
    const report = result.body.jobs?.[0];
    expect(report?.job).toBe("retention");
    expect(report?.status).toBe("dry_run");
    // dry_run ohlásil, co by smazal (zdravotní údaje: 1 řádek), ale nic nesmazal
    expect(report?.counts.health_rows).toBe(1);
    // hosté 2, domácnost, odpověď, osoba a zdravotní údaje (ještě neexistuje jiný způsob, jak by zmizely)
    expect(report?.counts.guest_rows).toBe(6);
    expect(await weddingState(wedding.weddingId, wedding.slug)).toEqual(before);
    expect((await weddingState(wedding.weddingId, wedding.slug)).healthRows).toBe(1);
  });

  test("neplatné parametry: 400; simulovaný čas jen s wedding_id a ne u úklidu", async ({
    request,
  }) => {
    const bad = await callCron(request, "/api/cron/lifecycle", { query: { batch: "0" } });
    expect(bad.status).toBe(400);
    const noWedding = await callCron(request, "/api/cron/lifecycle", {
      query: { now: "2040-01-01T00:00:00Z" },
    });
    expect(noWedding.status).toBe(400);
    expect(noWedding.body.error).toBe("wedding_id_required_with_now");
    const housekeeping = await callCron(request, "/api/cron/housekeeping", {
      query: { now: "2040-01-01T00:00:00Z", wedding_id: "5e2e0000-0000-4000-8000-0000000000aa" },
    });
    expect(housekeeping.status).toBe(400);
    expect(housekeeping.body.error).toBe("now_not_supported");
  });

  test("ostrý běh úklidu uspěje a zapíše se do evidence běhů", async ({ request }) => {
    const result = await callCron(request, "/api/cron/housekeeping");
    expect(result.status).toBe(200);
    const report = result.body.jobs?.[0];
    expect(report?.job).toBe("housekeeping");
    expect(report?.status).toBe("ok");
  });
});

test.describe("životní cyklus a retence v simulovaném čase (E2E-22, E2E-23)", () => {
  // jedna svatba, jedno pořadí kroků; úlohy téhož jména se nesmějí překrývat
  test.describe.configure({ mode: "serial" });

  test("od upozornění přes archivaci a mazání po lhůtách po trvalé smazání webu", async ({
    request,
  }) => {
    test.setTimeout(120_000);
    // svatba 15. 6. 2030: zdraví 15. 7. 2030, konec provozu 13. 9. 2030, hosté 15. 6. 2031 (půlnoc v Praze)
    const wedding = await seedLifecycleWedding("2030-06-15");
    const { weddingId, slug, adminEmail } = wedding;
    const mailHash = hmac(E2E_SECRETS.AUTH_SECRET, "email-log", adminEmail);
    let mailCount = 0;

    const expectNextMail = async (subject: RegExp) => {
      mailCount += 1;
      const raw = await waitForMail(adminEmail, mailCount);
      // typografie vkládá nezlomitelné mezery (jednopísmenné předložky, datum): pro porovnání se převedou
      const plain = (value: string) => value.replaceAll("\u00a0", " ");
      const mail = { ...raw, subject: plain(raw.subject), text: plain(raw.text) };
      expect(mail.subject).toMatch(subject);
      // žádné osobní údaje hostů v e-mailu
      for (const name of wedding.guestNames) {
        expect(`${mail.subject}${mail.text}${mail.html}`).not.toContain(name);
      }
      expect(`${mail.text}${mail.html}`).not.toMatch(/bezlepkov|ořechy/);
      return mail;
    };

    await test.step("výchozí stav: retenční data podle data svatby", async () => {
      const state = await weddingState(weddingId, slug);
      expect(state.status).toBe("published");
      expect(state.healthPurgeAt?.toISOString()).toBe("2030-07-14T22:00:00.000Z");
      expect(state.guestPurgeAt?.toISOString()).toBe("2031-06-14T22:00:00.000Z");
      expect(state.healthRows).toBe(1);
    });

    await test.step("14 dní před smazáním zdravotních údajů přijde první upozornění", async () => {
      const report = await runJobAt(request, "lifecycle", weddingId, "2030-07-01T12:00:00Z");
      expect(report.status).toBe("ok");
      expect(report.counts).toMatchObject({
        notices_planned_first: 1,
        notices_sent: 1,
        messages_sent: 1,
      });
      const mail = await expectNextMail(
        /^Dietní a alergické údaje hostů se smažou 15\.\s*července 2030$/,
      );
      expect(mail.text).toContain(`${slug}.localhost`);
      expect(mail.text).toMatch(/http:\/\/[^\s]+\/prihlaseni/);
      expect(await lifecycleNotices(weddingId)).toEqual([
        { kind: "health_purge", stage: "first", status: "sent", recipients: 1 },
      ]);
    });

    await test.step("opakovaný běh upozornění neduplikuje (jedno na událost)", async () => {
      const report = await runJobAt(request, "lifecycle", weddingId, "2030-07-02T12:00:00Z");
      expect(report.counts).toMatchObject({
        notices_planned_first: 0,
        notices_planned_final: 0,
        notices_sent: 0,
      });
      expect(readMails(adminEmail)).toHaveLength(mailCount);
    });

    await test.step("den před smazáním přijde závěrečné upozornění", async () => {
      const report = await runJobAt(request, "lifecycle", weddingId, "2030-07-14T12:00:00Z");
      expect(report.counts).toMatchObject({ notices_planned_final: 1, notices_sent: 1 });
      await expectNextMail(/^Připomenutí: Dietní a alergické údaje hostů se smažou/);
    });

    await test.step("před lhůtou se nic nemaže", async () => {
      const report = await runJobAt(request, "retention", weddingId, "2030-07-14T21:59:59Z");
      expect(report.counts).toMatchObject({ health_rows: 0, guest_rows: 0, weddings_due: 0 });
      expect((await weddingState(weddingId, slug)).healthRows).toBe(1);
    });

    await test.step("po lhůtě se smažou jen zdravotní údaje, hosté zůstanou", async () => {
      const report = await runJobAt(request, "retention", weddingId, "2030-07-16T12:00:00Z");
      expect(report.counts).toMatchObject({ health_rows: 1, guest_rows: 0 });
      await expect
        .poll(async () => (await weddingState(weddingId, slug)).healthRows, { timeout: 10_000 })
        .toBe(0);
      const state = await weddingState(weddingId, slug);
      expect(state.guestRows).toBe(4); // hosté 2, domácnost 1, odpověď 1
      expect(state.status).toBe("published");
    });

    await test.step("zpráva o smazání zdravotních údajů přijde po smazání a opakování nic neposílá", async () => {
      const report = await runJobAt(request, "lifecycle", weddingId, "2030-07-16T12:00:00Z");
      expect(report.counts).toMatchObject({ notices_sent: 1 });
      const mail = await expectNextMail(/^Dietní a alergické údaje hostů jsme smazali$/);
      expect(mail.text).toMatch(/nevratně smazali/);
      const again = await runJobAt(request, "lifecycle", weddingId, "2030-07-16T13:00:00Z");
      expect(again.counts).toMatchObject({ notices_sent: 0 });
      expect(readMails(adminEmail)).toHaveLength(mailCount);
    });

    await test.step("14 dní před koncem provozu přijde upozornění, web zatím běží", async () => {
      const report = await runJobAt(request, "lifecycle", weddingId, "2030-08-30T12:00:00Z");
      expect(report.counts).toMatchObject({
        archived: 0,
        notices_planned_first: 1,
        notices_sent: 1,
      });
      await expectNextMail(/^Váš svatební web přestane být veřejný 13\.\s*září 2030$/);
      expect((await weddingState(weddingId, slug)).status).toBe("published");
    });

    await test.step("po konci provozu se web archivuje a adresa zůstane vyhrazená", async () => {
      const report = await runJobAt(request, "lifecycle", weddingId, "2030-09-14T12:00:00Z");
      expect(report.counts).toMatchObject({ archived: 1 });
      await expect
        .poll(async () => (await weddingState(weddingId, slug)).status, { timeout: 10_000 })
        .toBe("archived");
      expect((await weddingState(weddingId, slug)).slugState).toBe("active");
      // archivace nepřepsala retenční data
      expect((await weddingState(weddingId, slug)).guestPurgeAt?.toISOString()).toBe(
        "2031-06-14T22:00:00.000Z",
      );
      const again = await runJobAt(request, "lifecycle", weddingId, "2030-09-15T12:00:00Z");
      expect(again.counts.archived).toBe(0);
    });

    await test.step("před smazáním údajů hostů přijde upozornění i u archivovaného webu", async () => {
      const report = await runJobAt(request, "lifecycle", weddingId, "2031-06-01T12:00:00Z");
      expect(report.counts).toMatchObject({ notices_planned_first: 1, notices_sent: 1 });
      const mail = await expectNextMail(/^Údaje hostů se smažou 15\.\s*června 2031$/);
      expect(mail.text).toMatch(/export hostů a odpovědí/);
    });

    await test.step("po 12 měsících se smažou údaje hostů", async () => {
      const report = await runJobAt(request, "retention", weddingId, "2031-06-16T12:00:00Z");
      // hosté 2, domácnost, odpověď, osoba (zdravotní údaje už zmizely dřív)
      expect(report.counts.guest_rows).toBe(5);
      await expect
        .poll(async () => (await weddingState(weddingId, slug)).guestRows, { timeout: 10_000 })
        .toBe(0);
      const sent = await runJobAt(request, "lifecycle", weddingId, "2031-06-16T12:00:00Z");
      expect(sent.counts).toMatchObject({ notices_sent: 1 });
      await expectNextMail(/^Údaje hostů jsme smazali$/);
    });

    await test.step("smazaný web se před koncem ochranné lhůty netýká trvalého mazání", async () => {
      const purgeAt = await markDeleted(weddingId);
      const early = await runJobAt(
        request,
        "retention",
        weddingId,
        new Date(purgeAt.getTime() - 3_600_000),
      );
      expect(early.counts).toMatchObject({ weddings_due: 0, weddings_purged: 0 });
      expect((await weddingState(weddingId, slug)).exists).toBe(true);

      const late = await runJobAt(
        request,
        "retention",
        weddingId,
        new Date(purgeAt.getTime() + 3_600_000),
      );
      expect(late.status).toBe("ok");
      expect(late.counts).toMatchObject({ weddings_due: 1, weddings_purged: 1, storage_failed: 0 });
      await expect
        .poll(async () => (await weddingState(weddingId, slug)).exists, { timeout: 10_000 })
        .toBe(false);
      await expectNextMail(/^Svatební web jsme trvale smazali$/);
    });

    await test.step("adresa smazaného webu zůstala trvale blokovaná (retired)", async () => {
      expect((await weddingState(weddingId, slug)).slugState).toBe("retired");
    });

    await test.step("audit nese jen počty a stavy, žádné osobní údaje; záznam e-mailů jen typ a doménu", async () => {
      const audit = await auditOf(weddingId);
      const actions = audit.map((row) => row.action);
      expect(actions).toEqual(
        expect.arrayContaining(["lifecycle.notice", "retention.purge", "wedding.status_change"]),
      );
      expect(
        audit
          .filter((row) => row.action === "retention.purge")
          .map((row) => (row.meta as { kind: string }).kind),
      ).toEqual(expect.arrayContaining(["health", "guests", "wedding"]));
      const text = JSON.stringify(audit);
      for (const forbidden of [
        ...wedding.guestNames,
        adminEmail,
        "bezlepkov",
        "ořechy",
        "Klára",
        "Matěj",
      ]) {
        expect(text, `audit nesmí obsahovat ${forbidden}`).not.toContain(forbidden);
      }
      const log = await emailLogOf(mailHash);
      expect(log.map((row) => row.type)).toEqual([
        "expiry_notice",
        "expiry_notice",
        "deletion_notice",
        "expiry_notice",
        "expiry_notice",
        "deletion_notice",
        // zpráva o smazání webu: svatba už neexistuje, proto bez odkazu na ni
        "deletion_notice",
      ]);
      expect(
        log.every((row) => row.status === "sent" && row.recipient_domain === "example.test"),
      ).toBe(true);
      expect(log.at(-1)?.wedding_id).toBeNull();
    });
  });

  test("běhy úloh se evidují s počty a výsledek je v auditu bez osobních údajů", async ({
    request,
  }) => {
    const wedding = await seedLifecycleWedding("2030-06-15");
    const report = await runJobAt(request, "retention", wedding.weddingId, "2030-07-17T08:30:00Z");
    expect(report.status).toBe("ok");
    const runs = await withDb(async (db) => {
      const result = await db.query<{
        job: string;
        status: string;
        counts: Record<string, number>;
        clock_at: Date;
      }>(
        "select job, status, counts, clock_at from se_vezmou.job_runs where job = 'retention' and clock_at = $1 order by started_at desc limit 1",
        ["2030-07-17T08:30:00Z"],
      );
      return result.rows;
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "ok", counts: { health_rows: 1 } });
    const audit = await withDb(async (db) => {
      const result = await db.query<{ meta: { job: string; status: string } }>(
        "select meta from se_vezmou.audit_log where action = 'job.run' and meta ->> 'job' = 'retention' order by id desc limit 5",
      );
      return result.rows;
    });
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toMatch(/@|example\.test/);
  });
});
