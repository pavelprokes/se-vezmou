import { InfoPage, infoMetadata } from "@/components/landing/info-page";

const ROUTE = "seating";
const SEGMENT = "zasedaci-poradek-na-svatbu";

export async function generateMetadata({
  params,
}: PageProps<"/h/marketing/[locale]/zasedaci-poradek-na-svatbu">) {
  const { locale } = await params;
  return infoMetadata(ROUTE, SEGMENT, locale);
}

export default async function Page({
  params,
}: PageProps<"/h/marketing/[locale]/zasedaci-poradek-na-svatbu">) {
  const { locale } = await params;
  return <InfoPage route={ROUTE} segment={SEGMENT} localeParam={locale} />;
}
