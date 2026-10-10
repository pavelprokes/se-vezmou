import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CircleAlert, CircleCheck } from "lucide-react";
import { DocumentTitle } from "@/components/document-title";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { isLocale, localePath, toLocale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { resolveSlug } from "@/lib/db/rpc";

type Props = PageProps<"/h/tenant/[slug]/[locale]/upozorneni">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: (await getTranslator(toLocale(locale), ["rsvp"]))("rsvp.unsubscribe.title"),
    robots: { index: false, follow: false },
    // Web páru posílá `Referrer-Policy: no-referrer`; s ní by prohlížeč u odeslání formuláře poslal
    // `Origin: null` a kontrola původu by odhlášení odmítla. `same-origin` adresu webu cizím stránkám
    // dál neprozradí.
    referrer: "same-origin",
  };
}

const TOKEN = /^[0-9a-f]{36}$/;

/**
 * Odhlášení upozornění na změny z odkazu v e-mailu. Zobrazení nic nemění (odkazy otevírají i kontroly
 * pošty a náhledy), odhlásí až tlačítko (POST na `/upozorneni/odhlasit`). Funguje i na zamčeném webu
 * bez PINu: stránka nic z webu neukazuje.
 */
export default async function UnsubscribePage({ params, searchParams }: Props) {
  await connection();
  const { slug, locale } = await params;
  if (!isLocale(locale) || !(await resolveSlug(slug))) notFound();
  const query = await searchParams;
  const token = typeof query.t === "string" && TOKEN.test(query.t) ? query.t : null;
  const state = query.hotovo ? "done" : query.chyba || !token ? "invalid" : "confirm";
  const t = await getTranslator(locale, ["rsvp"]);

  return (
    <main id="obsah" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-8">
      <DocumentTitle title={t("rsvp.unsubscribe.title")} />
      <h1 className="text-ink text-4xl font-medium">{t("rsvp.unsubscribe.title")}</h1>
      <div role="status" className="mt-4">
        {state === "done" ? (
          <p className="text-ink flex items-center gap-2 text-lg font-medium">
            <Icon icon={CircleCheck} />
            <span>{t("rsvp.unsubscribe.done")}</span>
          </p>
        ) : state === "invalid" ? (
          <p className="text-ink flex items-center gap-2 text-lg font-medium">
            <Icon icon={CircleAlert} />
            <span>{t("rsvp.unsubscribe.invalid")}</span>
          </p>
        ) : null}
      </div>
      {state === "confirm" && token ? (
        <form method="post" action={localePath("/upozorneni/odhlasit", locale)} className="mt-2">
          <p className="text-muted max-w-prose text-lg">{t("rsvp.unsubscribe.intro")}</p>
          <input type="hidden" name="t" value={token} />
          <button type="submit" className={`${buttonVariants()} mt-6`}>
            {t("rsvp.unsubscribe.button")}
          </button>
        </form>
      ) : null}
      <a
        href={localePath("/", locale)}
        className="text-pine min-h-target mt-8 inline-flex items-center underline underline-offset-4"
      >
        {t("rsvp.unsubscribe.back")}
      </a>
    </main>
  );
}
