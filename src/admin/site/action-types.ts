import type { GalleryCard } from "@/site/types";
import type { Issue } from "./doc";

/**
 * Tvary odpovědí Server Actions správy webu (M7a). Jsou záměrně prostá data (serializovatelná
 * přes hranici server/prohlížeč): stav a případně důvod, nikdy výjimka a nikdy obsah webu.
 */

export type Guarded<T> = T | { status: "error" } | { status: "unauthorized" };

export type SaveActionResult = Guarded<
  | { status: "saved"; rev: number }
  | { status: "conflict"; rev: number }
  | { status: "invalid" }
  | { status: "not_editable" }
  | { status: "limited"; retryAfter: number }
>;

export type PublishActionResult = Guarded<
  | { status: "published"; versionNo: number; slug: string; warnings: Issue[] }
  | { status: "invalid"; issues: Issue[] }
  | { status: "not_publishable" }
  | { status: "conflict" }
  | { status: "limited"; retryAfter: number }
>;

export type SimpleActionResult = Guarded<
  { status: "ok" } | { status: "failed" } | { status: "limited"; retryAfter: number }
>;

export type CheckpointActionResult = Guarded<
  | { status: "ok"; versionNo: number }
  | { status: "invalid" }
  | { status: "limited"; retryAfter: number }
>;

export type RestoreActionResult = Guarded<
  | { status: "restored"; rev: number; versionNo: number }
  | { status: "not_found" }
  | { status: "conflict" }
  | { status: "not_editable" }
  | { status: "limited"; retryAfter: number }
>;

export type QuickNoticeActionResult = Guarded<
  { status: "ok" } | { status: "empty" } | { status: "invalid" } | { status: "not_editable" }
>;

export type GalleryCardActionResult = Guarded<
  | { status: "ok"; card: GalleryCard }
  | { status: "failed"; reason: string; card: GalleryCard }
  | { status: "invalid_url" }
  | { status: "limited"; retryAfter: number }
>;

/** Akce, které editor dostává ze serverové stránky (Server Actions jako props). */
export interface EditorActions {
  save(input: { doc: unknown; baseRev: number }): Promise<SaveActionResult>;
  /** `baseRev`: revize pracovní kopie, kterou editor vidí; zastaralé okno nic nezveřejní. */
  publish(note: string, baseRev: number): Promise<PublishActionResult>;
  unpublish(): Promise<SimpleActionResult>;
  checkpoint(note: string): Promise<CheckpointActionResult>;
  quickNotice(input: unknown): Promise<QuickNoticeActionResult>;
  refreshGalleryCard(url: string): Promise<GalleryCardActionResult>;
}
