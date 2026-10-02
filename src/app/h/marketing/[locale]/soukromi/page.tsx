import { LegalPage, legalMetadata } from "@/components/landing/legal-page";

const ROUTE = "privacy";
const SEGMENT = "soukromi";

export async function generateMetadata({ params }: PageProps<"/h/marketing/[locale]/soukromi">) {
  const { locale } = await params;
  return legalMetadata(ROUTE, SEGMENT, locale);
}

/** Zástupná právní stránka (soukromi); text doplní provozovatel. Jazykovou variantu ověřuje `LegalPage`. */
export default async function Page({ params }: PageProps<"/h/marketing/[locale]/soukromi">) {
  const { locale } = await params;
  return <LegalPage route={ROUTE} segment={SEGMENT} localeParam={locale} />;
}
