import { InfoPage, infoMetadata } from "@/components/landing/info-page";

const ROUTE = "rsvp";
const SEGMENT = "wedding-rsvp";

export async function generateMetadata({
  params,
}: PageProps<"/h/marketing/[locale]/wedding-rsvp">) {
  const { locale } = await params;
  return infoMetadata(ROUTE, SEGMENT, locale);
}

export default async function Page({ params }: PageProps<"/h/marketing/[locale]/wedding-rsvp">) {
  const { locale } = await params;
  return <InfoPage route={ROUTE} segment={SEGMENT} localeParam={locale} />;
}
