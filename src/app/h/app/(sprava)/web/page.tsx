import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ADMIN_PATHS, appHref } from "@/admin/paths";
import { liveSite } from "@/admin/site-href";
import { reconcileGalleryMedia } from "@/admin/site/doc";
import { checkpointDue, isManaged, loadSite } from "@/admin/site/server";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { AdminI18nProvider } from "@/components/admin/i18n";
import { pickAdminMessages } from "@/components/admin/messages";
import { SiteEditor } from "@/components/admin/site-editor";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getTranslator } from "@/i18n/load";
import { listMedia, storageAvailable } from "@/lib/media/service";
import {
  checkpointAction,
  deletePhotoAction,
  exportPhotosAction,
  finishPhotoUploadAction,
  renewPhotoUploadAction,
  requestPhotoUploadAction,
  updatePhotoAction,
  publishSiteAction,
  quickNoticeAction,
  refreshGalleryCardAction,
  saveSiteAction,
  unpublishSiteAction,
} from "./actions";

/**
 * Zpracování fotografií na serveru (`finishPhotoUploadAction`: sharp, varianty ve WebP a AVIF) je nejdelší
 * operace aplikace: `maxDuration` stránky platí pro všechny Server Actions, které se z ní volají (docs Next.js,
 * Route Segment Config: maxDuration). Nahrání samotné jde přímo do úložiště a funkci nezatěžuje.
 */
export const maxDuration = 60;

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslator(await getUiLocale(), ["admin"]))("admin.nav.site") };
}

/**
 * Úprava webu páru (FR-ADM-1 až FR-ADM-3): obecné údaje, sekce s obsahem po jazycích, průběžné
 * ukládání konceptu, zveřejnění, stažení z publikace a živý náhled. Web, který ještě nikdy nebyl
 * zveřejněný, se dokončuje v průvodci (ten je do prvního zveřejnění jediným zapisovatelem).
 */
export default async function EditSitePage() {
  const session = await requireSession();
  const locale = await getUiLocale();
  const t = await getTranslator(locale, ["admin"]);

  const loaded = await loadSite(session);
  if (!loaded) notFound();
  const { meta } = loaded;
  const media = isManaged(meta) ? await listMedia(session) : [];
  // Galerie obsahuje všechny hotové fotografie; pořadí z konceptu se sjednotí s tabulkou médií
  const doc = reconcileGalleryMedia(loaded.doc, media);
  const site = await liveSite(meta.slug, doc.wedding.defaultLocale);

  if (!isManaged(meta)) {
    return (
      <AdminI18nProvider locale={locale} messages={await pickAdminMessages(locale)}>
        <AdminFrame
          locale={locale}
          path={ADMIN_PATHS.site}
          active="site"
          title={t("admin.nav.site")}
          help="site"
        >
          <Card>
            <p className="text-lg">{t("admin.overview.status.draft")}</p>
            <p className="mt-4">
              <a href={appHref("/vytvorit", locale)} className={buttonVariants()}>
                {t("admin.overview.finish")}
              </a>
            </p>
          </Card>
        </AdminFrame>
      </AdminI18nProvider>
    );
  }

  return (
    <AdminI18nProvider locale={locale} messages={await pickAdminMessages(locale)}>
      <AdminFrame
        locale={locale}
        path={ADMIN_PATHS.site}
        active="site"
        title={t("admin.nav.site")}
        help="site"
        wide
      >
        <SiteEditor
          uiLocale={locale}
          initial={{
            doc,
            meta: {
              slug: meta.slug,
              status: meta.status,
              rev: meta.rev,
              hasGuestPin: meta.hasGuestPin,
              guestPinEnabled: meta.guestPinEnabled,
              publishedVersionNo: meta.publishedVersionNo,
              hasUnpublishedChanges: meta.hasUnpublishedChanges,
              quickNotice: meta.quickNotice,
              quickNoticeEnabled: meta.quickNoticeEnabled,
            },
          }}
          actions={{
            save: saveSiteAction,
            publish: publishSiteAction,
            unpublish: unpublishSiteAction,
            checkpoint: checkpointAction,
            quickNotice: quickNoticeAction,
            refreshGalleryCard: refreshGalleryCardAction,
          }}
          initialMedia={media}
          mediaActions={{
            requestUpload: requestPhotoUploadAction,
            renewUpload: renewPhotoUploadAction,
            finishUpload: finishPhotoUploadAction,
            update: updatePhotoAction,
            remove: deletePhotoAction,
            exportPhotos: exportPhotosAction,
          }}
          photosAvailable={storageAvailable()}
          siteHref={site?.url ?? null}
          historyHref={appHref(ADMIN_PATHS.history, locale)}
          needsCheckpoint={checkpointDue(loaded)}
        />
      </AdminFrame>
    </AdminI18nProvider>
  );
}
