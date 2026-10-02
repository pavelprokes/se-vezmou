import type { Guarded } from "@/admin/site/action-types";
import type { FailureCode, MediaItem } from "./types";

/**
 * Tvary odpovědí Server Actions fotografií (M7c): prostá serializovatelná data, stav a případně důvod, nikdy
 * výjimka, klíč v úložišti ani obsah souboru.
 */

export type RequestUploadActionResult = Guarded<
  | {
      status: "ok";
      id: string;
      url: string;
      headers: Record<string, string>;
      expiresInSeconds: number;
    }
  | { status: "quota" }
  | { status: "too_large" }
  | { status: "bad_type" }
  | { status: "not_editable" }
  | { status: "unavailable" }
  | { status: "limited"; retryAfter: number }
>;

export type RenewUploadActionResult = Guarded<
  | {
      status: "ok";
      id: string;
      url: string;
      headers: Record<string, string>;
      expiresInSeconds: number;
    }
  | { status: "not_found" }
  | { status: "quota" }
  | { status: "too_large" }
  | { status: "bad_type" }
  | { status: "not_editable" }
  | { status: "unavailable" }
  | { status: "limited"; retryAfter: number }
>;

export type FinishUploadActionResult = Guarded<
  | { status: "ok"; item: MediaItem }
  | { status: "failed"; code: FailureCode }
  | { status: "busy" }
  | { status: "not_found" }
  | { status: "unavailable" }
  | { status: "limited"; retryAfter: number }
>;

export type UpdateMediaActionResult = Guarded<
  | { status: "ok"; item: MediaItem }
  | { status: "invalid" }
  | { status: "not_found" }
  | { status: "limited"; retryAfter: number }
>;

export type DeleteMediaActionResult = Guarded<
  | { status: "ok" }
  | { status: "not_found" }
  | { status: "unavailable" }
  | { status: "limited"; retryAfter: number }
>;

export type PhotoDownload = { name: string; url: string; bytes: number; width: number };

export type PhotoExportActionResult = Guarded<
  | { status: "ok"; files: PhotoDownload[] }
  | { status: "empty" }
  | { status: "unavailable" }
  | { status: "limited"; retryAfter: number }
>;

/** Akce fotografií, které editor dostává ze serverové stránky (Server Actions jako props). */
export interface MediaActions {
  requestUpload(input: { mime: string; bytes: number }): Promise<RequestUploadActionResult>;
  renewUpload(input: { id: string; mime: string }): Promise<RenewUploadActionResult>;
  finishUpload(id: string): Promise<FinishUploadActionResult>;
  update(input: {
    id: string;
    alt: { cs?: string; en?: string } | null;
    decorative: boolean;
  }): Promise<UpdateMediaActionResult>;
  remove(id: string): Promise<DeleteMediaActionResult>;
  exportPhotos(): Promise<PhotoExportActionResult>;
}
