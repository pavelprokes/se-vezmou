import { LegalPage, legalMetadata } from "@/components/landing/legal-page";

const ROUTE = "accessibility";
const SEGMENT = "accessibility";

export async function generateMetadata({
  params,
}: PageProps<"/h/marketing/[locale]/accessibility">) {
  const { locale } = await params;
  return legalMetadata(ROUTE, SEGMENT, locale);
}

/** Zástupná právní stránka (accessibility); text doplní provozovatel. Jazykovou variantu ověřuje `LegalPage`. */
export default async function Page({ params }: PageProps<"/h/marketing/[locale]/accessibility">) {
  const { locale } = await params;
  return <LegalPage route={ROUTE} segment={SEGMENT} localeParam={locale} />;
}
