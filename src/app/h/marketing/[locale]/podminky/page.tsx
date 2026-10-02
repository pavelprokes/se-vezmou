import { LegalPage, legalMetadata } from "@/components/landing/legal-page";

const ROUTE = "terms";
const SEGMENT = "podminky";

export async function generateMetadata({ params }: PageProps<"/h/marketing/[locale]/podminky">) {
  const { locale } = await params;
  return legalMetadata(ROUTE, SEGMENT, locale);
}

/** Zástupná právní stránka (podminky); text doplní provozovatel. Jazykovou variantu ověřuje `LegalPage`. */
export default async function Page({ params }: PageProps<"/h/marketing/[locale]/podminky">) {
  const { locale } = await params;
  return <LegalPage route={ROUTE} segment={SEGMENT} localeParam={locale} />;
}
