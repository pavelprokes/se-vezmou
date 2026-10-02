import { LegalPage, legalMetadata } from "@/components/landing/legal-page";

const ROUTE = "terms";
const SEGMENT = "terms";

export async function generateMetadata({ params }: PageProps<"/h/marketing/[locale]/terms">) {
  const { locale } = await params;
  return legalMetadata(ROUTE, SEGMENT, locale);
}

/** Zástupná právní stránka (terms); text doplní provozovatel. Jazykovou variantu ověřuje `LegalPage`. */
export default async function Page({ params }: PageProps<"/h/marketing/[locale]/terms">) {
  const { locale } = await params;
  return <LegalPage route={ROUTE} segment={SEGMENT} localeParam={locale} />;
}
