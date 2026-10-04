import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coreText } from "@/lib/email/templates/test-helpers";
import { NBSP } from "@/i18n/typo";
import { DbError } from "@/lib/db/transport";
import { createMemoryStorage, type MemoryStorage } from "@/lib/storage/memory";
import { createUnconfiguredStorage, setStorage } from "@/lib/storage";
import type { NoticeContext } from "@/lib/lifecycle/notices";
import type { ClaimedNotice, DueWedding } from "@/lib/lifecycle/rpc";
import type { JobContext } from "../run";

const rpc = vi.hoisted(() => ({
  archiveDue: vi.fn(),
  deleteArchived: vi.fn(),
  claimPurge: vi.fn(),
  releasePurge: vi.fn(),
  enqueueNotices: vi.fn(),
  noticesPending: vi.fn(),
  claimNotices: vi.fn(),
  noticeRecipients: vi.fn(),
  finishNotice: vi.fn(),
  releaseNotices: vi.fn(),
  purgeHealthData: vi.fn(),
  purgeGuestData: vi.fn(),
  dueWeddings: vi.fn(),
  purgeWedding: vi.fn(),
  purgeExpiredSlugReservations: vi.fn(),
  housekeeping: vi.fn(),
}));
vi.mock("@/lib/lifecycle/rpc", () => rpc);

const sendTemplatedEmail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email/send", () => ({ sendTemplatedEmail }));

vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://app.se-vezmou.cz" },
  requireEnv: () => "auth-secret-auth-secret-auth-secret-01",
}));

const stubContext = vi.hoisted(() => ({
  send: vi.fn(),
  loginUrl: "https://app.se-vezmou.cz/prihlaseni",
  siteOf: (slug: string | null) => (slug ? `${slug}.se-vezmou.cz` : undefined),
}));
vi.mock("@/lib/lifecycle/notices", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/lifecycle/notices")>()),
  createNoticeContext: () => stubContext as NoticeContext,
}));

import { housekeepingJob } from "./housekeeping";
import { lifecycleJob } from "./lifecycle";
import { retentionJob } from "./retention";

const A = "0b6a1c1e-3b5e-4d0c-9a1f-0d3c7e9a1b11";
const B = "7c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5";
const NOW = new Date("2027-07-12T10:00:00Z");

const context = (overrides: Partial<JobContext> = {}): JobContext => ({
  now: NOW,
  dryRun: false,
  batch: 50,
  weddingId: null,
  timeLeftMs: () => 30_000,
  ...overrides,
});

/** Stejná pojistka jako spouštěč audit_log_guard: klíč v počtech nesmí vypadat jako osobní údaj. */
const AUDIT_FORBIDDEN_KEY =
  /"([a-z_]*(e_?mail|name|diet|allerg|phone|address)[a-z_]*|ip|ip_address|user_agent)"\s*:/i;
const expectAuditSafe = (counts: Record<string, number>) => {
  expect(JSON.stringify(counts)).not.toMatch(AUDIT_FORBIDDEN_KEY);
};

const notice = (overrides: Partial<ClaimedNotice> = {}): ClaimedNotice => ({
  notice_id: "n1",
  wedding_id: A,
  kind: "health_purge",
  stage: "first",
  event_at: "2027-07-11T22:00:00Z",
  slug: "klara-a-matej",
  locale: "cs",
  timezone: "Europe/Prague",
  attempt: 1,
  ...overrides,
});

beforeEach(() => {
  for (const mock of Object.values(rpc)) mock.mockReset();
  sendTemplatedEmail.mockReset();
  stubContext.send.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  rpc.archiveDue.mockResolvedValue(0);
  rpc.releaseNotices.mockResolvedValue(1);
  rpc.deleteArchived.mockResolvedValue(0);
  rpc.claimPurge.mockResolvedValue(true);
  rpc.releasePurge.mockResolvedValue(undefined);
  rpc.enqueueNotices.mockResolvedValue({ first: 0, final: 0 });
  rpc.noticesPending.mockResolvedValue(0);
  rpc.claimNotices.mockResolvedValue([]);
  rpc.noticeRecipients.mockResolvedValue([]);
  rpc.purgeHealthData.mockResolvedValue(0);
  rpc.purgeGuestData.mockResolvedValue(0);
  rpc.dueWeddings.mockResolvedValue([]);
  rpc.purgeExpiredSlugReservations.mockResolvedValue(0);
  rpc.housekeeping.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
  setStorage(null);
});

describe("úloha životního cyklu", () => {
  it("archivuje, naplánuje a odešle upozornění po dávkách s počty bez osobních údajů", async () => {
    rpc.archiveDue.mockResolvedValue(2);
    rpc.deleteArchived.mockResolvedValue(4);
    rpc.enqueueNotices.mockResolvedValue({ first: 1, final: 1 });
    rpc.claimNotices
      .mockResolvedValueOnce([notice(), notice({ notice_id: "n2", wedding_id: B, slug: null })])
      .mockResolvedValueOnce([]);
    rpc.noticeRecipients.mockImplementation(async (weddingId: string) =>
      weddingId === A
        ? [
            { email: "jan@example.test", locale: "cs" },
            { email: "eva@example.test", locale: "cs" },
          ]
        : [],
    );
    rpc.finishNotice.mockImplementation(async (_id: string, sent: number, failed: number) =>
      sent + failed === 0 ? "skipped" : sent === 0 ? "failed" : "sent",
    );
    stubContext.send.mockResolvedValue(true);

    const result = await lifecycleJob.run(context());

    expect(result.status).toBe("ok");
    expect(result.counts).toMatchObject({
      archived: 2,
      archived_deleted: 4,
      notices_planned_first: 1,
      notices_planned_final: 1,
      notices_sent: 1,
      notices_skipped: 1,
      notices_failed: 0,
      messages_sent: 2,
      messages_failed: 0,
    });
    expectAuditSafe(result.counts);
    expect(rpc.archiveDue).toHaveBeenCalledWith(
      expect.objectContaining({ now: NOW, batch: 50, dryRun: false, weddingId: null }),
    );
    expect(rpc.finishNotice).toHaveBeenCalledWith("n1", 2, 0);
    expect(rpc.finishNotice).toHaveBeenCalledWith("n2", 0, 0);
    // zpráva: čeština, adresa webu, odkaz na přihlášení
    const first = stubContext.send.mock.calls[0][0];
    expect(first).toMatchObject({
      type: "expiry_notice",
      to: "jan@example.test",
      weddingId: A,
      locale: "cs",
    });
    expect(first.email.text).toContain("klara-a-matej.se-vezmou.cz");
    expect(first.email.text).toContain("https://app.se-vezmou.cz/prihlaseni");
  });

  it("zprávu o provedeném smazání (fáze done) odesílá jako deletion_notice s časem běhu", async () => {
    rpc.claimNotices
      .mockResolvedValueOnce([notice({ stage: "done", kind: "guest_purge" })])
      .mockResolvedValueOnce([]);
    rpc.noticeRecipients.mockResolvedValue([{ email: "jan@example.test", locale: "en" }]);
    rpc.finishNotice.mockResolvedValue("sent");
    stubContext.send.mockResolvedValue(true);

    await lifecycleJob.run(context());

    const sent = stubContext.send.mock.calls[0][0];
    expect(sent.type).toBe("deletion_notice");
    expect(sent.locale).toBe("en");
    expect(sent.email.subject).toBe("We deleted guest data");
    expect(sent.email.text).toContain(`12${NBSP}July 2027`);
  });

  it("nedoručené upozornění se hlásí jako partial (zkusí se znovu)", async () => {
    rpc.claimNotices.mockResolvedValueOnce([notice()]).mockResolvedValueOnce([]);
    rpc.noticeRecipients.mockResolvedValue([{ email: "jan@example.test", locale: "cs" }]);
    rpc.finishNotice.mockResolvedValue("failed");
    stubContext.send.mockResolvedValue(false);
    const result = await lifecycleJob.run(context());
    expect(result.status).toBe("partial");
    expect(result.counts).toMatchObject({
      notices_failed: 1,
      messages_failed: 1,
      messages_sent: 0,
    });
  });

  it("chyba doručení u jednoho adresáta neznamená chybu úlohy ani duplicitu u ostatních", async () => {
    rpc.claimNotices.mockResolvedValueOnce([notice()]).mockResolvedValueOnce([]);
    rpc.noticeRecipients.mockResolvedValue([
      { email: "jan@example.test", locale: "cs" },
      { email: "eva@example.test", locale: "cs" },
    ]);
    rpc.finishNotice.mockResolvedValue("sent");
    stubContext.send.mockRejectedValueOnce(new Error("SES")).mockResolvedValueOnce(true);
    const result = await lifecycleJob.run(context());
    expect(rpc.finishNotice).toHaveBeenCalledWith("n1", 1, 1);
    expect(result.counts).toMatchObject({ messages_sent: 1, messages_failed: 1 });
  });

  it("dry_run nic nepřebírá ani neposílá: jen počty", async () => {
    rpc.archiveDue.mockResolvedValue(3);
    rpc.enqueueNotices.mockResolvedValue({ first: 2, final: 0 });
    rpc.noticesPending.mockResolvedValue(4);
    const result = await lifecycleJob.run(context({ dryRun: true }));
    expect(result.counts).toEqual({
      archived: 3,
      archived_deleted: 0,
      notices_planned_first: 2,
      notices_planned_final: 0,
      notices_pending: 4,
    });
    expect(rpc.archiveDue).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(rpc.enqueueNotices).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(rpc.claimNotices).not.toHaveBeenCalled();
    expect(stubContext.send).not.toHaveBeenCalled();
  });

  it("selhání přesunu archivovaných webů nezastaví upozornění: partial", async () => {
    rpc.deleteArchived.mockRejectedValue(new Error("db"));
    const result = await lifecycleJob.run(context());
    expect(result.status).toBe("partial");
    expect(result.counts.archived_deleted).toBe(0);
    expect(rpc.enqueueNotices).toHaveBeenCalled();
  });

  it("selhání archivace nezastaví upozornění: partial", async () => {
    rpc.archiveDue.mockRejectedValue(new DbError("lifecycle_archive_due", "40001", "chyba SQL"));
    rpc.claimNotices.mockResolvedValue([]);
    const result = await lifecycleJob.run(context());
    expect(result.status).toBe("partial");
    expect(result.errorCode).toBe("archive:DbError:lifecycle_archive_due:40001");
    expect(rpc.enqueueNotices).toHaveBeenCalled();
    expect(rpc.claimNotices).toHaveBeenCalled();
  });

  it("výjimka při jednom upozornění neshodí ostatní; upozornění zůstane převzaté k pozdějšímu pokusu", async () => {
    rpc.claimNotices
      .mockResolvedValueOnce([notice(), notice({ notice_id: "n2" })])
      .mockResolvedValueOnce([]);
    rpc.noticeRecipients.mockResolvedValue([{ email: "jan@example.test", locale: "cs" }]);
    rpc.finishNotice.mockRejectedValueOnce(new Error("db")).mockResolvedValueOnce("sent");
    stubContext.send.mockResolvedValue(true);
    const result = await lifecycleJob.run(context());
    expect(result.status).toBe("partial");
    expect(result.counts.notices_sent).toBe(1);
  });

  it("čas dojde uprostřed dávky: další upozornění se už nezačne odesílat (žádné odeslání bez zápisu výsledku)", async () => {
    let left = 30_000;
    rpc.claimNotices
      .mockResolvedValueOnce([notice(), notice({ notice_id: "n2" })])
      .mockResolvedValueOnce([]);
    rpc.noticeRecipients.mockResolvedValue([{ email: "jan@example.test", locale: "cs" }]);
    rpc.finishNotice.mockImplementation(async () => {
      left = 500; // po prvním upozornění zbývá méně než rezerva
      return "sent";
    });
    stubContext.send.mockResolvedValue(true);
    const result = await lifecycleJob.run(context({ timeLeftMs: () => left }));
    expect(rpc.finishNotice).toHaveBeenCalledTimes(1);
    expect(stubContext.send).toHaveBeenCalledTimes(1);
    expect(result.counts.deferred).toBe(1);
    expect(rpc.claimNotices).toHaveBeenCalledTimes(1);
    // neodeslané převzaté upozornění se vrátí do fronty bez započítaného pokusu
    expect(rpc.releaseNotices).toHaveBeenCalledWith(["n2"]);
    expect(result.counts.notices_sent).toBe(1);
    expect(result.status).toBe("partial");
  });

  it("vyčerpaný časový rozpočet: nic se nepřebírá, výsledek je partial a dokončí ho další běh", async () => {
    const result = await lifecycleJob.run(context({ timeLeftMs: () => 500 }));
    expect(result.status).toBe("partial");
    expect(result.counts.deferred).toBe(1);
    expect(rpc.claimNotices).not.toHaveBeenCalled();
  });

  it("omezení na svatbu a simulovaný čas se předají databázi", async () => {
    await lifecycleJob.run(context({ weddingId: A }));
    expect(rpc.archiveDue).toHaveBeenCalledWith(
      expect.objectContaining({ weddingId: A, now: NOW }),
    );
    expect(rpc.claimNotices).toHaveBeenCalledWith(
      expect.objectContaining({ weddingId: A, now: NOW }),
    );
  });
});

const due = (id: string, overrides: Partial<DueWedding> = {}): DueWedding => ({
  wedding_id: id,
  purge_at: "2027-07-10T00:00:00Z",
  media_count: 2,
  slug: "klara-a-matej",
  timezone: "Europe/Prague",
  locale: "cs",
  ...overrides,
});

describe("úloha retence", () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = createMemoryStorage();
    setStorage(storage);
    storage.put(`${A}/foto/1.webp`);
    storage.put(`${A}/foto/2.webp`);
    storage.put(`${B}/foto/1.webp`);
    sendTemplatedEmail.mockResolvedValue(true);
  });

  it("maže zdravotní údaje a údaje hostů a trvale smaže weby: nejdřív soubory, potom řádky", async () => {
    rpc.purgeHealthData.mockResolvedValue(3);
    rpc.purgeGuestData.mockResolvedValue(11);
    rpc.dueWeddings.mockResolvedValue([due(A)]);
    rpc.noticeRecipients.mockResolvedValue([{ email: "jan@example.test", locale: "cs" }]);
    const order: string[] = [];
    rpc.noticeRecipients.mockImplementation(async () => {
      order.push("recipients");
      return [{ email: "jan@example.test", locale: "cs" }];
    });
    rpc.purgeWedding.mockImplementation(async () => {
      order.push(`purge:files=${storage.keys().filter((k) => k.startsWith(A)).length}`);
      return { kind: "wedding", guests: 0, blocks: 0, media: 2, storage_paths: [] };
    });

    const result = await retentionJob.run(context());

    expect(result.status).toBe("ok");
    expect(result.counts).toMatchObject({
      health_rows: 3,
      guest_rows: 11,
      weddings_due: 1,
      weddings_purged: 1,
      files_deleted: 2,
      storage_failed: 0,
      messages_sent: 1,
    });
    expectAuditSafe(result.counts);
    // adresy se čtou před smazáním, soubory zmizely ještě před smazáním řádků
    expect(order).toEqual(["recipients", "purge:files=0"]);
    expect(storage.keys()).toEqual([`${B}/foto/1.webp`]);
    expect(rpc.purgeWedding).toHaveBeenCalledWith(A, NOW);
    // zpráva o smazání: bez wedding_id (svatba už neexistuje), typ deletion_notice, bez osobních údajů hostů
    const sent = sendTemplatedEmail.mock.calls[0][0];
    expect(sent).toMatchObject({
      type: "deletion_notice",
      weddingId: null,
      to: "jan@example.test",
    });
    expect(sent.email.subject).toBe("Svatební web jsme trvale smazali");
    expect(coreText(sent.email.text)).not.toContain("https://");
  });

  it("selhání mazání souborů web NEoznačí za vymazaný: řádky zůstanou a další web pokračuje", async () => {
    storage.failDeleteFor.add(A);
    rpc.dueWeddings.mockResolvedValue([due(A), due(B)]);
    rpc.noticeRecipients.mockResolvedValue([]);
    rpc.purgeWedding.mockResolvedValue({
      kind: "wedding",
      guests: 0,
      blocks: 0,
      media: 1,
      storage_paths: [],
    });

    const result = await retentionJob.run(context());

    expect(result.status).toBe("partial");
    expect(result.errorCode).toBe("storage_delete_failed");
    expect(result.counts).toMatchObject({
      weddings_purged: 1,
      storage_failed: 1,
      files_deleted: 1,
    });
    expect(rpc.purgeWedding).toHaveBeenCalledTimes(1);
    expect(rpc.purgeWedding).toHaveBeenCalledWith(B, NOW);
    expect(rpc.purgeWedding).not.toHaveBeenCalledWith(A, expect.anything());
    expect(storage.keys()).toContain(`${A}/foto/1.webp`);
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("smaže i karanténu s nedokončenými originály (incoming/{wedding_id}/) a cizí soubory nechá", async () => {
    storage.put(`incoming/${A}/9d2f1a40-5b6c-4d7e-8f90-a1b2c3d4e5f6`);
    storage.put(`incoming/${B}/9d2f1a40-5b6c-4d7e-8f90-a1b2c3d4e5f6`);
    rpc.dueWeddings.mockResolvedValue([due(A)]);
    rpc.noticeRecipients.mockResolvedValue([]);
    rpc.purgeWedding.mockResolvedValue({
      kind: "wedding",
      guests: 0,
      blocks: 0,
      media: 2,
      storage_paths: [],
    });
    const result = await retentionJob.run(context());
    expect(result.counts).toMatchObject({ weddings_purged: 1, files_deleted: 3 });
    expect(storage.keys()).toEqual([
      `${B}/foto/1.webp`,
      `incoming/${B}/9d2f1a40-5b6c-4d7e-8f90-a1b2c3d4e5f6`,
    ]);
  });

  it("bez nastaveného úložiště se web s fotografiemi nesmaže, web bez fotografií ano", async () => {
    setStorage(createUnconfiguredStorage(["R2_BUCKET"]));
    rpc.dueWeddings.mockResolvedValue([due(A, { media_count: 2 }), due(B, { media_count: 0 })]);
    rpc.noticeRecipients.mockResolvedValue([]);
    rpc.purgeWedding.mockResolvedValue({
      kind: "wedding",
      guests: 0,
      blocks: 0,
      media: 0,
      storage_paths: [],
    });
    const result = await retentionJob.run(context());
    expect(result.status).toBe("partial");
    expect(result.errorCode).toBe("storage_delete_failed");
    expect(result.counts).toMatchObject({ weddings_purged: 1, storage_failed: 1 });
    expect(rpc.purgeWedding).toHaveBeenCalledTimes(1);
    expect(rpc.purgeWedding).toHaveBeenCalledWith(B, NOW);
  });

  it("další běh po opravě úložiště web dokončí (idempotentní opakování)", async () => {
    storage.failDeleteFor.add(A);
    rpc.dueWeddings.mockResolvedValue([due(A)]);
    rpc.purgeWedding.mockResolvedValue({
      kind: "wedding",
      guests: 0,
      blocks: 0,
      media: 2,
      storage_paths: [],
    });
    expect((await retentionJob.run(context())).status).toBe("partial");
    storage.failDeleteFor.clear();
    const second = await retentionJob.run(context());
    expect(second.status).toBe("ok");
    expect(second.counts).toMatchObject({ weddings_purged: 1, files_deleted: 2 });
  });

  it("čerstvá kontrola a převzetí proběhnou těsně PŘED mazáním souborů, ty před smazáním řádků", async () => {
    rpc.dueWeddings.mockResolvedValue([due(A)]);
    const order: string[] = [];
    rpc.claimPurge.mockImplementation(async () => {
      order.push(`claim:files=${storage.keys().filter((k) => k.startsWith(A)).length}`);
      return true;
    });
    rpc.purgeWedding.mockImplementation(async () => {
      order.push(`purge:files=${storage.keys().filter((k) => k.startsWith(A)).length}`);
      return { kind: "wedding", guests: 0, blocks: 0, media: 2, storage_paths: [] };
    });
    const result = await retentionJob.run(context());
    expect(result.status).toBe("ok");
    expect(order).toEqual(["claim:files=2", "purge:files=0"]);
    expect(rpc.claimPurge).toHaveBeenCalledWith(A, NOW);
    expect(rpc.releasePurge).not.toHaveBeenCalled();
  });

  it("web obnovený operátorem mezi seznamem a mazáním: soubory PŘEŽIJÍ, řádky se nemažou", async () => {
    rpc.dueWeddings.mockResolvedValue([due(A), due(B)]);
    // A je mezitím obnovený: čerstvá kontrola ho nepřevezme (false), B pokračuje
    rpc.claimPurge.mockImplementation(async (weddingId: string) => weddingId !== A);
    rpc.purgeWedding.mockResolvedValue({
      kind: "wedding",
      guests: 0,
      blocks: 0,
      media: 1,
      storage_paths: [],
    });
    const result = await retentionJob.run(context());
    expect(result.status).toBe("ok");
    expect(result.counts).toMatchObject({ weddings_restored: 1, weddings_purged: 1 });
    // fotografie obnoveného webu zůstaly, fotografie smazaného webu B zmizely
    expect(storage.keys().filter((k) => k.startsWith(A))).toHaveLength(2);
    expect(storage.keys().filter((k) => k.startsWith(B))).toHaveLength(0);
    expect(rpc.purgeWedding).not.toHaveBeenCalledWith(A, expect.anything());
    expect(rpc.releasePurge).not.toHaveBeenCalled();
  });

  it("selhání převzetí (chyba databáze): nic se nemaže, úloha je partial", async () => {
    rpc.dueWeddings.mockResolvedValue([due(A)]);
    rpc.claimPurge.mockRejectedValue(new DbError("retention_claim", "40001", "chyba SQL"));
    const result = await retentionJob.run(context());
    expect(result.status).toBe("partial");
    expect(result.errorCode).toBe("purge_claim_failed");
    expect(storage.keys().filter((k) => k.startsWith(A))).toHaveLength(2);
    expect(rpc.purgeWedding).not.toHaveBeenCalled();
  });

  it("po selhání mazání souborů i řádků se převzetí uvolní (další pokus po záloze)", async () => {
    storage.failDeleteFor.add(A);
    rpc.dueWeddings.mockResolvedValue([due(A), due(B)]);
    rpc.purgeWedding.mockRejectedValueOnce(new DbError("purge_wedding", "40001", "chyba SQL"));
    const result = await retentionJob.run(context());
    expect(result.status).toBe("partial");
    // A: selhalo mazání souborů, B: selhalo mazání řádků; obě převzetí se uvolnila
    expect(rpc.releasePurge).toHaveBeenCalledWith(A);
    expect(rpc.releasePurge).toHaveBeenCalledWith(B);
    expect(rpc.releasePurge).toHaveBeenCalledTimes(2);
  });

  it("selhání uvolnění převzetí úlohu neshodí (zapůjčení v databázi vyprší samo)", async () => {
    storage.failDeleteFor.add(A);
    rpc.dueWeddings.mockResolvedValue([due(A)]);
    rpc.releasePurge.mockRejectedValue(new Error("síť"));
    const result = await retentionJob.run(context());
    expect(result.status).toBe("partial");
    expect(result.errorCode).toBe("storage_delete_failed");
  });

  it("web mezitím obnovený operátorem se nesmaže a není to chyba", async () => {
    rpc.dueWeddings.mockResolvedValue([due(A)]);
    rpc.purgeWedding.mockRejectedValue(
      new DbError("purge_wedding", "55000", "wedding_not_purgeable"),
    );
    const result = await retentionJob.run(context());
    expect(result.status).toBe("ok");
    expect(result.counts).toMatchObject({ weddings_restored: 1, weddings_purged: 0 });
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("jiná chyba mazání webu: partial, další web pokračuje", async () => {
    rpc.dueWeddings.mockResolvedValue([due(A), due(B)]);
    rpc.purgeWedding
      .mockRejectedValueOnce(new DbError("purge_wedding", "40001", "chyba SQL"))
      .mockResolvedValueOnce({
        kind: "wedding",
        guests: 0,
        blocks: 0,
        media: 1,
        storage_paths: [],
      });
    const result = await retentionJob.run(context());
    expect(result.status).toBe("partial");
    expect(result.counts.weddings_purged).toBe(1);
  });

  it("nedoručená zpráva o smazání úlohu neshodí (adresy po smazání nelze znovu načíst)", async () => {
    rpc.dueWeddings.mockResolvedValue([due(A)]);
    rpc.noticeRecipients.mockResolvedValue([{ email: "jan@example.test", locale: "cs" }]);
    rpc.purgeWedding.mockResolvedValue({
      kind: "wedding",
      guests: 0,
      blocks: 0,
      media: 2,
      storage_paths: [],
    });
    sendTemplatedEmail.mockResolvedValue(false);
    const result = await retentionJob.run(context());
    expect(result.status).toBe("ok");
    expect(result.counts).toMatchObject({
      weddings_purged: 1,
      messages_failed: 1,
      messages_sent: 0,
    });
  });

  it("dry_run nemaže soubory ani řádky, jen hlásí počty", async () => {
    rpc.purgeHealthData.mockResolvedValue(3);
    rpc.dueWeddings.mockResolvedValue([due(A), due(B, { media_count: 5 })]);
    const result = await retentionJob.run(context({ dryRun: true }));
    expect(result.counts).toEqual({
      health_rows: 3,
      guest_rows: 0,
      weddings_due: 2,
      files_to_delete: 7,
    });
    expect(rpc.purgeHealthData).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(rpc.purgeWedding).not.toHaveBeenCalled();
    expect(storage.keys()).toHaveLength(3);
  });

  it("omezení na svatbu a simulovaný čas se předají databázi", async () => {
    await retentionJob.run(context({ weddingId: A, now: new Date("2030-01-01T00:00:00Z") }));
    const expected = expect.objectContaining({
      weddingId: A,
      now: new Date("2030-01-01T00:00:00Z"),
    });
    expect(rpc.purgeHealthData).toHaveBeenCalledWith(expected);
    expect(rpc.purgeGuestData).toHaveBeenCalledWith(expected);
    expect(rpc.dueWeddings).toHaveBeenCalledWith(expected);
  });

  it("vyčerpaný rozpočet: weby se nemažou a dokončí je další běh", async () => {
    rpc.dueWeddings.mockResolvedValue([due(A)]);
    const result = await retentionJob.run(context({ timeLeftMs: () => 100 }));
    expect(result.status).toBe("partial");
    expect(rpc.purgeWedding).not.toHaveBeenCalled();
    expect(storage.keys()).toHaveLength(3);
  });

  it("selhání mazání zdravotních údajů nezastaví mazání webů", async () => {
    rpc.purgeHealthData.mockRejectedValue(new DbError("purge_health_data", "40001", "chyba SQL"));
    rpc.dueWeddings.mockResolvedValue([due(A)]);
    rpc.purgeWedding.mockResolvedValue({
      kind: "wedding",
      guests: 0,
      blocks: 0,
      media: 2,
      storage_paths: [],
    });
    const result = await retentionJob.run(context());
    expect(result.status).toBe("partial");
    expect(result.counts.weddings_purged).toBe(1);
  });
});

describe("úloha úklidu", () => {
  it("uvolní rezervace a uklidí; počty mají bezpečné klíče", async () => {
    rpc.purgeExpiredSlugReservations.mockResolvedValue(2);
    rpc.housekeeping.mockResolvedValue({
      sessions: 4,
      operator_sessions: 0,
      login_challenges: 1,
      rsvp_tickets: 0,
      rate_limits: 9,
      lockouts: 0,
      analytics_events: 5,
      mail_log: 7,
      job_runs: 1,
    });
    const result = await housekeepingJob.run(context());
    expect(result.status).toBe("ok");
    expect(result.counts).toMatchObject({
      slug_reservations_released: 2,
      cleaned_sessions: 4,
      cleaned_mail_log: 7,
    });
    // klíče z databázové funkce housekeeping musí projít kontrolou meta v audit_log
    expectAuditSafe(result.counts);
  });

  it("dry_run se předá databázi", async () => {
    await housekeepingJob.run(context({ dryRun: true }));
    expect(rpc.housekeeping).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(rpc.purgeExpiredSlugReservations).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
    );
  });

  it("selhání rezervací nezastaví úklid", async () => {
    rpc.purgeExpiredSlugReservations.mockRejectedValue(new Error("db"));
    rpc.housekeeping.mockResolvedValue({ sessions: 1 });
    const result = await housekeepingJob.run(context());
    expect(result.status).toBe("partial");
    expect(result.counts.cleaned_sessions).toBe(1);
  });
});
