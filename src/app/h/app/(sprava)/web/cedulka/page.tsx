import type { Metadata } from "next";
import { ADMIN_PATHS, appHref } from "@/admin/paths";
import { gallerySignLayout } from "@/admin/gallery-sign/pdf";
import { loadGallerySign, parseGallerySignOptions } from "@/admin/gallery-sign/server";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { GallerySignPreview } from "@/components/admin/gallery-sign-preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Radio } from "@/components/ui/choice";
import { Fieldset } from "@/components/ui/field";
import { getTranslator } from "@/i18n/load";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getTranslator(await getUiLocale(), ["admin"]))("admin.gallerySign.title"),
  };
}

/**
 * Cedulka s QR kódem galerie na stůl (fáze 1): volby obyčejným GET formulářem, náhled ve vzhledu
 * šablony a stažení PDF A4 k tisku (POST, stejně jako jmenovky). Adresa galerie je z pracovní kopie
 * webu (blok Fotky), u vlastní galerie autora s parametry UTM.
 */
export default async function GallerySignPage({ searchParams }: PageProps<"/h/app/web/cedulka">) {
  const session = await requireSession();
  const locale = await getUiLocale();
  const t = await getTranslator(locale, ["admin"]);
  const params = await searchParams;
  const options = parseGallerySignOptions((key) => params[key]);
  const data = await loadGallerySign(session, options);
  const layout = data.content
    ? await gallerySignLayout(options.format, data.content, data.style)
    : null;
  const pageHref = appHref(ADMIN_PATHS.gallerySign, locale);
  const languageLabel = (code: string) =>
    code === "cs" ? t("admin.gallerySign.languageCs") : t("admin.gallerySign.languageEn");

  return (
    <AdminFrame
      locale={locale}
      path={ADMIN_PATHS.gallerySign}
      active="site"
      title={t("admin.gallerySign.title")}
      intro={t("admin.gallerySign.intro")}
      help="site"
      wide
    >
      <div className="flex flex-col gap-6">
        {!data.url ? (
          <Card>
            <p className="text-lg">{t("admin.gallerySign.noLink")}</p>
            <a
              href={`${appHref(ADMIN_PATHS.site, locale)}#galerie`}
              className="min-h-target text-pine mt-3 inline-flex items-center underline underline-offset-4"
            >
              {t("admin.gallerySign.toEditor")}
            </a>
          </Card>
        ) : (
          <>
            <Card as="section" aria-labelledby="gallery-sign-options">
              <h2 id="gallery-sign-options" className="text-2xl font-medium">
                {t("admin.gallerySign.options")}
              </h2>
              <form method="get" action={pageHref} className="mt-4 flex flex-col gap-5">
                <Fieldset legend={t("admin.gallerySign.text")}>
                  <div className="flex flex-col gap-1">
                    <Radio
                      name="text"
                      value="pridat"
                      label={t("admin.gallerySign.textUpload")}
                      defaultChecked={options.variant === "upload"}
                    />
                    <Radio
                      name="text"
                      value="prohlizeni"
                      label={t("admin.gallerySign.textView")}
                      defaultChecked={options.variant === "view"}
                    />
                  </div>
                </Fieldset>
                <Fieldset legend={t("admin.gallerySign.format")}>
                  <div className="flex flex-col gap-1">
                    <Radio
                      name="format"
                      value="ramecek"
                      label={t("admin.gallerySign.formatFrame")}
                      defaultChecked={options.format === "frame"}
                    />
                    <Radio
                      name="format"
                      value="a5"
                      label={t("admin.gallerySign.formatA5")}
                      defaultChecked={options.format === "a5"}
                    />
                  </div>
                </Fieldset>
                {data.siteLocales.length > 1 ? (
                  <Fieldset legend={t("admin.gallerySign.language")}>
                    <div className="flex flex-col gap-1">
                      <Radio
                        name="jazyk"
                        value="obe"
                        label={t("admin.gallerySign.languageBoth")}
                        defaultChecked={options.language === "both"}
                      />
                      {data.siteLocales.map((code) => (
                        <Radio
                          key={code}
                          name="jazyk"
                          value={code}
                          label={languageLabel(code)}
                          defaultChecked={options.language === code}
                        />
                      ))}
                    </div>
                  </Fieldset>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <Button type="submit" variant="secondary">
                    {t("admin.gallerySign.apply")}
                  </Button>
                  {/* Stažení bere aktuálně zaškrtnuté volby, ne jen ty z posledního náhledu */}
                  <Button
                    type="submit"
                    formMethod="post"
                    formAction={appHref(`${ADMIN_PATHS.gallerySign}/pdf`, locale)}
                  >
                    {t("admin.gallerySign.download")}
                  </Button>
                </div>
              </form>
            </Card>

            <Card as="section" aria-labelledby="gallery-sign-preview">
              <h2 id="gallery-sign-preview" className="text-2xl font-medium">
                {t("admin.gallerySign.preview")}
              </h2>
              <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,20rem)_1fr]">
                {layout && data.content && data.qrUrl ? (
                  <GallerySignPreview
                    layout={layout}
                    style={data.style}
                    qrUrl={data.qrUrl}
                    label={t("admin.gallerySign.previewLabel", { heading: data.content.heading })}
                  />
                ) : null}
                <div className="flex flex-col gap-3">
                  <p>
                    <span className="text-muted">{t("admin.gallerySign.leadsTo")} </span>
                    <span className="break-all" data-testid="gallery-sign-url">
                      {data.qrUrl}
                    </span>
                  </p>
                  {data.ownGallery ? (
                    <p className="text-muted max-w-prose">{t("admin.gallerySign.utmNote")}</p>
                  ) : null}
                  {data.protectedLink ? (
                    <p className="max-w-prose font-medium">
                      {t("admin.gallerySign.protectedNote")}
                    </p>
                  ) : null}
                  {data.blockDisabled ? (
                    <p className="max-w-prose font-medium">
                      {t("admin.gallerySign.blockDisabled")}
                    </p>
                  ) : null}
                  <p className="text-muted max-w-prose">
                    {t(
                      options.format === "a5"
                        ? "admin.gallerySign.printTipA5"
                        : "admin.gallerySign.printTipFrame",
                    )}
                  </p>
                  <p className="text-muted max-w-prose">{t("admin.gallerySign.testTip")}</p>
                </div>
              </div>
            </Card>
          </>
        )}
      </div>
    </AdminFrame>
  );
}
