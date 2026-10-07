import { InfoPage, infoMetadata } from "@/components/landing/info-page";

const ROUTE = "rsvp";
const SEGMENT = "potvrzeni-ucasti-hostu";

export async function generateMetadata({
  params,
}: PageProps<"/h/marketing/[locale]/potvrzeni-ucasti-hostu">) {
  const { locale } = await params;
  return infoMetadata(ROUTE, SEGMENT, locale);
}

export default async function Page({
  params,
}: PageProps<"/h/marketing/[locale]/potvrzeni-ucasti-hostu">) {
  const { locale } = await params;
  return <InfoPage route={ROUTE} segment={SEGMENT} localeParam={locale} />;
}
