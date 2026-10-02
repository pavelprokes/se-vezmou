import { locale as rootLocale } from "next/root-params";
import { NotFoundContent } from "@/components/not-found-content";
import { isLocale } from "@/i18n/config";

export default async function MarketingNotFound() {
  const locale = await rootLocale();
  return <NotFoundContent locale={locale && isLocale(locale) ? locale : "cs"} />;
}
