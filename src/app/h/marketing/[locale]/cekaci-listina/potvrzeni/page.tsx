import {
  WaitlistConfirmPage,
  waitlistConfirmMetadata,
} from "@/components/landing/waitlist-confirm-page";

const SEGMENT = "potvrzeni";

export async function generateMetadata({
  params,
}: PageProps<"/h/marketing/[locale]/cekaci-listina/potvrzeni">) {
  const { locale } = await params;
  return waitlistConfirmMetadata(SEGMENT, locale);
}

/** Potvrzení zápisu na čekací listinu (potvrzeni); jazykovou variantu ověřuje `WaitlistConfirmPage`. */
export default async function Page({
  params,
  searchParams,
}: PageProps<"/h/marketing/[locale]/cekaci-listina/potvrzeni">) {
  const { locale } = await params;
  const token = (await searchParams).t;
  return (
    <WaitlistConfirmPage
      segment={SEGMENT}
      localeParam={locale}
      token={typeof token === "string" ? token : undefined}
    />
  );
}
