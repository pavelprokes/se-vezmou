import { locale as rootLocale } from "next/root-params";
import { NotFoundContent } from "@/components/not-found-content";
import { isLocale } from "@/i18n/config";

/** Stejná stránka 404 pro každý neexistující web, bez nabídky jiných webů a bez slugu v textu. */
export default async function TenantNotFound() {
  const locale = await rootLocale();
  return <NotFoundContent locale={locale && isLocale(locale) ? locale : "cs"} />;
}
