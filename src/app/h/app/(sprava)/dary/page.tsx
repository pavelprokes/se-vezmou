import type { Metadata } from "next";
import { ADMIN_PATHS, appHref } from "@/admin/paths";
import { listGifts } from "@/admin/gifts/server";
import { loadSite } from "@/admin/site/server";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { GiftRegistry } from "@/components/admin/gifts/gift-registry";
import { AdminI18nProvider } from "@/components/admin/i18n";
import { pickAdminMessages } from "@/components/admin/messages";
import { Card } from "@/components/ui/card";
import { defaultLocale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { giftCommandAction, saveGiftAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslator(await getUiLocale(), ["admin"]))("admin.gifts.title") };
}

/**
 * Seznam věcných darů (fáze 2). Hosté ho uvidí v sekci Dary na webu (s PINem hostů až po zadání PINu)
 * a dar si zarezervují bez účtu; ostatní vidí „zabráno“. Jméno u rezervace je nepovinné.
 */
export default async function GiftsPage() {
  const session = await requireSession();
  const locale = await getUiLocale();
  const t = await getTranslator(locale, ["admin"]);
  const [items, site] = await Promise.all([listGifts(session), loadSite(session)]);
  const wedding = site?.doc.wedding;
  const locales = wedding
    ? [wedding.defaultLocale, ...wedding.locales.filter((l) => l !== wedding.defaultLocale)]
    : [defaultLocale];
  const block = site?.doc.blocks.find((b) => b.type === "gifts");
  const blockOff = !block || !block.enabled;

  return (
    <AdminI18nProvider locale={locale} messages={await pickAdminMessages(locale)}>
      <AdminFrame
        locale={locale}
        path={ADMIN_PATHS.gifts}
        active="site"
        title={t("admin.gifts.title")}
        intro={t("admin.gifts.intro")}
        help="gifts"
        wide
      >
        <div className="flex flex-col gap-6">
          <Card>
            <p className="max-w-prose">{t("admin.gifts.howItWorks")}</p>
            {blockOff ? (
              <p className="mt-3 max-w-prose font-medium" data-testid="gifts-block-off">
                {t("admin.gifts.blockOff")}{" "}
                <a
                  href={`${appHref(ADMIN_PATHS.site, locale)}#block-gifts`}
                  className="text-pine underline underline-offset-4"
                >
                  {t("admin.gifts.toEditor")}
                </a>
              </p>
            ) : null}
          </Card>
          <GiftRegistry
            initial={items}
            locales={locales}
            save={saveGiftAction}
            command={giftCommandAction}
          />
        </div>
      </AdminFrame>
    </AdminI18nProvider>
  );
}
