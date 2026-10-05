import { InfoPage, infoMetadata } from "@/components/landing/info-page";

const ROUTE = "photographers";
const SEGMENT = "for-photographers";

export async function generateMetadata({
  params,
}: PageProps<"/h/marketing/[locale]/for-photographers">) {
  const { locale } = await params;
  return infoMetadata(ROUTE, SEGMENT, locale);
}

export default async function Page({
  params,
}: PageProps<"/h/marketing/[locale]/for-photographers">) {
  const { locale } = await params;
  return <InfoPage route={ROUTE} segment={SEGMENT} localeParam={locale} />;
}
