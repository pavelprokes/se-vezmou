import type { Metadata } from "next";
import { ADMIN_PATHS, appHref } from "@/admin/paths";
import { perSheet } from "@/admin/name-cards/layout";
import { cardFaces } from "@/admin/name-cards/pdf";
import { loadNameCards, parseNameCardOptions } from "@/admin/name-cards/server";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { NameCardPreview } from "@/components/admin/guests/name-card-preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Radio } from "@/components/ui/choice";
import { Fieldset } from "@/components/ui/field";
import { getTranslator } from "@/i18n/load";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getTranslator(await getUiLocale(), ["admin.guests"]))(
      "admin.guests.nameCards.title",
    ),
  };
}

const selectClass =
  "min-h-target rounded-button bg-parchment text-ink border-field-border border-2 px-3 py-2 text-base";

/**
 * Jmenovky na stůl: výběr (kdo, skupina, formát, řádek s datem) obyčejným GET formulářem, náhled
 * ve vzhledu šablony webu a stažení PDF A4 k tisku (POST, jména jsou osobní údaje).
 */
export default async function NameCardsPage({ searchParams }: PageProps<"/h/app/hoste/jmenovky">) {
  const session = await requireSession();
  const locale = await getUiLocale();
  const t = await getTranslator(locale, ["admin.guests"]);
  const params = await searchParams;
  const options = parseNameCardOptions((key) => params[key]);
  const data = await loadNameCards(session, options);
  const faces = await cardFaces(data.names, data.detail, data.style, options.format);
  const sheet = perSheet(options.format);
  const sheets = Math.ceil(faces.length / sheet);
  const pageHref = appHref(ADMIN_PATHS.nameCards, locale);

  return (
    <AdminFrame
      locale={locale}
      path={ADMIN_PATHS.nameCards}
      active="guests"
      title={t("admin.guests.nameCards.title")}
      intro={t("admin.guests.nameCards.intro")}
      help="guests"
      wide
    >
      <div className="flex flex-col gap-6">
        <Card as="section" aria-labelledby="name-cards-options">
          <h2 id="name-cards-options" className="text-2xl font-medium">
            {t("admin.guests.nameCards.options")}
          </h2>
          <form method="get" action={pageHref} className="mt-4 flex flex-col gap-5">
            <Fieldset legend={t("admin.guests.nameCards.who")}>
              <div className="flex flex-wrap gap-x-6">
                <Radio
                  name="kdo"
                  value="prijdou"
                  label={t("admin.guests.nameCards.whoAttending")}
                  defaultChecked={options.audience === "attending"}
                />
                <Radio
                  name="kdo"
                  value="vsichni"
                  label={t("admin.guests.nameCards.whoAll")}
                  defaultChecked={options.audience === "all"}
                />
              </div>
            </Fieldset>
            {data.tags.length > 0 ? (
              <div className="flex flex-col gap-2">
                <label htmlFor="name-cards-group" className="font-medium">
                  {t("admin.guests.nameCards.group")}
                </label>
                <select
                  id="name-cards-group"
                  name="skupina"
                  defaultValue={options.group ?? ""}
                  className={`${selectClass} max-w-sm`}
                >
                  <option value="">{t("admin.guests.list.groupAll")}</option>
                  {data.tags.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <Fieldset legend={t("admin.guests.nameCards.format")}>
              <div className="flex flex-col gap-1">
                <Radio
                  name="format"
                  value="plocha"
                  label={t("admin.guests.nameCards.formatFlat")}
                  defaultChecked={options.format === "flat"}
                />
                <Radio
                  name="format"
                  value="stojanek"
                  label={t("admin.guests.nameCards.formatTent")}
                  defaultChecked={options.format === "tent"}
                />
              </div>
            </Fieldset>
            <Fieldset legend={t("admin.guests.nameCards.detail")}>
              <div className="flex flex-wrap gap-x-6">
                <Radio
                  name="radek"
                  value="1"
                  label={t("admin.guests.nameCards.detailOn")}
                  defaultChecked={options.detail}
                />
                <Radio
                  name="radek"
                  value="0"
                  label={t("admin.guests.nameCards.detailOff")}
                  defaultChecked={!options.detail}
                />
              </div>
            </Fieldset>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" variant="secondary">
                {t("admin.guests.nameCards.apply")}
              </Button>
              {/* Stažení bere aktuálně zaškrtnuté volby, ne jen ty z posledního náhledu */}
              {faces.length > 0 ? (
                <Button
                  type="submit"
                  formMethod="post"
                  formAction={appHref(`${ADMIN_PATHS.nameCards}/pdf`, locale)}
                >
                  {t("admin.guests.nameCards.download")}
                </Button>
              ) : null}
            </div>
          </form>
        </Card>

        <Card as="section" aria-labelledby="name-cards-preview">
          <h2 id="name-cards-preview" className="text-2xl font-medium">
            {t("admin.guests.nameCards.preview")}
          </h2>
          {faces.length === 0 ? (
            <p className="mt-2 text-lg">{t("admin.guests.nameCards.empty")}</p>
          ) : (
            <>
              <p className="mt-2" data-testid="name-cards-count">
                {t("admin.guests.nameCards.count", { cards: faces.length, sheets })}
              </p>
              <p className="text-muted mt-3 max-w-prose">
                {t(
                  options.format === "tent"
                    ? "admin.guests.nameCards.printTipTent"
                    : "admin.guests.nameCards.printTipFlat",
                )}
              </p>
              <ul
                className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                aria-label={t("admin.guests.nameCards.preview")}
              >
                {faces.slice(0, sheet).map((face, index) => (
                  <li key={`${index}-${face.name}`}>
                    <NameCardPreview
                      face={face}
                      style={data.style}
                      label={t("admin.guests.nameCards.cardLabel", { name: face.name })}
                    />
                  </li>
                ))}
              </ul>
              {faces.length > sheet ? (
                <p className="text-muted mt-4">
                  {t("admin.guests.nameCards.more", { n: faces.length - sheet })}
                </p>
              ) : null}
            </>
          )}
        </Card>
      </div>
    </AdminFrame>
  );
}
