import { InfoPage, infoMetadata } from "@/components/landing/info-page";

const ROUTE = "bilingual";
const SEGMENT = "dvojjazycny-svatebni-web";

export async function generateMetadata({
  params,
}: PageProps<"/h/marketing/[locale]/dvojjazycny-svatebni-web">) {
  const { locale } = await params;
  return infoMetadata(ROUTE, SEGMENT, locale);
}

export default async function Page({
  params,
}: PageProps<"/h/marketing/[locale]/dvojjazycny-svatebni-web">) {
  const { locale } = await params;
  return <InfoPage route={ROUTE} segment={SEGMENT} localeParam={locale} />;
}
