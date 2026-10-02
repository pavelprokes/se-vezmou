"use server";

import { z } from "zod";
import { guarded } from "@/admin/guard";
import type {
  CheckpointActionResult,
  GalleryCardActionResult,
  PublishActionResult,
  QuickNoticeActionResult,
  RestoreActionResult,
  SaveActionResult,
  SimpleActionResult,
} from "@/admin/site/action-types";
import {
  createCheckpoint,
  publishSiteVersion,
  refreshGalleryCard,
  restoreVersion,
  saveSite,
  setQuickNotice,
  unpublishSite,
} from "@/admin/site/server";

/**
 * Server Actions správy webu (M7a). Každá začíná kontrolou původu a ověřením relace (`guarded`),
 * vstup prochází zodem a svatba je vždy ta z relace. Obsah webu se nikdy nedostane do logu.
 */

const saveSchema = z.object({ doc: z.unknown(), baseRev: z.number().int().min(0) });
const noteSchema = z.string().max(200);
const urlSchema = z.string().max(500);
const versionSchema = z.uuid();

export async function saveSiteAction(input: unknown): Promise<SaveActionResult> {
  return guarded("uložení webu", async (session) => {
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) return { status: "invalid" as const };
    return saveSite(session, parsed.data);
  });
}

export async function publishSiteAction(note: unknown): Promise<PublishActionResult> {
  return guarded("zveřejnění webu", async (session) =>
    publishSiteVersion(session, noteSchema.catch("").parse(note)),
  );
}

export async function unpublishSiteAction(): Promise<SimpleActionResult> {
  return guarded("stažení webu", (session) => unpublishSite(session));
}

export async function checkpointAction(note: unknown): Promise<CheckpointActionResult> {
  return guarded("bod pro vrácení", async (session) =>
    createCheckpoint(session, noteSchema.catch("").parse(note) || null),
  );
}

export async function restoreVersionAction(versionId: unknown): Promise<RestoreActionResult> {
  return guarded("vrácení verze", async (session) => {
    const parsed = versionSchema.safeParse(versionId);
    if (!parsed.success) return { status: "not_found" as const };
    return restoreVersion(session, parsed.data);
  });
}

export async function quickNoticeAction(input: unknown): Promise<QuickNoticeActionResult> {
  return guarded("rychlá změna", (session) => setQuickNotice(session, input));
}

export async function refreshGalleryCardAction(url: unknown): Promise<GalleryCardActionResult> {
  return guarded("náhled galerie", async (session) => {
    const parsed = urlSchema.safeParse(url);
    if (!parsed.success) return { status: "invalid_url" as const };
    return refreshGalleryCard(session, parsed.data);
  });
}
