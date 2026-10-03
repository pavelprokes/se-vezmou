import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Accordion } from "@/components/ui/accordion";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Radio } from "@/components/ui/choice";
import { Field, Fieldset } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { SiteHeader } from "@/components/site-header";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translator";
import { devPagesEnabled } from "@/site/dev-gate";
import { Heart, MapPin } from "lucide-react";

export const metadata: Metadata = {
  title: "UI katalog",
  robots: { index: false, follow: false },
};

/**
 * Vizuální katalog UI primitiv pro vývoj a automatické testy přístupnosti.
 * Mimo produkci (`VERCEL_ENV=production`) se nezobrazuje; jinde jen s `ENABLE_UI_CATALOG=1`
 * nebo ve vývojovém režimu. Čte prostředí za běhu (`connection()`), takže se nevypeče do sestavení.
 */
export default async function UiCatalog({ params }: PageProps<"/h/marketing/[locale]/ui-catalog">) {
  await connection();
  if (!devPagesEnabled()) notFound();

  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createTranslator(locale);

  return (
    <>
      <SiteHeader locale={locale} route="home" />
      <main id="obsah" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-8">
        <h1 className="text-4xl font-medium">{t("catalog.title")}</h1>
        <p className="text-muted mt-3">{t("catalog.lead")}</p>

        <section aria-labelledby="cat-buttons" className="mt-10 flex flex-col gap-4">
          <h2 id="cat-buttons" className="text-2xl">
            {t("catalog.buttons")}
          </h2>
          <div className="flex flex-wrap gap-3">
            <Button>{t("catalog.button.primary")}</Button>
            <Button variant="secondary">{t("catalog.button.secondary")}</Button>
            <Button variant="text">{t("catalog.button.text")}</Button>
            <Button disabled>{t("catalog.button.disabled")}</Button>
            <a href="#obsah" className={buttonVariants({ variant: "secondary" })}>
              {t("catalog.button.secondary")}
            </a>
          </div>
        </section>

        <section aria-labelledby="cat-fields" className="mt-10 flex flex-col gap-4">
          <h2 id="cat-fields" className="text-2xl">
            {t("catalog.fields")}
          </h2>
          <Field
            label={t("catalog.field.name")}
            hint={t("catalog.field.nameHint")}
            autoComplete="name"
          />
          <Field
            label={t("catalog.field.email")}
            type="email"
            autoComplete="email"
            defaultValue="klara"
            error={t("catalog.field.emailError")}
          />
        </section>

        <section aria-labelledby="cat-choices" className="mt-10 flex flex-col gap-4">
          <h2 id="cat-choices" className="text-2xl">
            {t("catalog.choices")}
          </h2>
          <Checkbox label={t("catalog.checkbox.vegetarian")} name="vegetarian" />
          <Fieldset legend={t("catalog.radio.legend")}>
            <Radio label={t("catalog.radio.yes")} name="ceremony" value="yes" defaultChecked />
            <Radio label={t("catalog.radio.no")} name="ceremony" value="no" />
          </Fieldset>
        </section>

        <section aria-labelledby="cat-cards" className="mt-10 flex flex-col gap-4">
          <h2 id="cat-cards" className="text-2xl">
            {t("catalog.cards")}
          </h2>
          <Card as="article" aria-labelledby="cat-card-title">
            <h3 id="cat-card-title" className="text-xl">
              {t("catalog.card.title")}
            </h3>
            <p className="text-muted mt-2">{t("catalog.card.body")}</p>
            <p className="mt-3 font-medium">{t("catalog.guests", { count: 1 })}</p>
            <p className="font-medium">{t("catalog.guests", { count: 3 })}</p>
            <p className="font-medium">{t("catalog.guests", { count: 60 })}</p>
          </Card>
        </section>

        <section aria-labelledby="cat-faq" className="mt-10 flex flex-col gap-4">
          <h2 id="cat-faq" className="text-2xl">
            {t("catalog.faq")}
          </h2>
          <Accordion
            items={[
              { id: "q1", title: t("catalog.faq.q1"), content: t("catalog.faq.a1") },
              { id: "q2", title: t("catalog.faq.q2"), content: t("catalog.faq.a2") },
            ]}
          />
        </section>

        <section aria-labelledby="cat-icons" className="mt-10 flex flex-col gap-4">
          <h2 id="cat-icons" className="text-2xl">
            {t("catalog.icons")}
          </h2>
          <p className="flex items-center gap-2">
            <Icon icon={MapPin} className="text-pine" />
            {t("catalog.icon.decorative")}
          </p>
          <p>
            <Icon
              icon={Heart}
              label={t("catalog.icon.meaningful")}
              className="text-cinnamon-deep"
            />
          </p>
        </section>
      </main>
    </>
  );
}
