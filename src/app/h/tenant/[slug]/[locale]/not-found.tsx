import { locale as rootLocale } from "next/root-params";
import type { Metadata } from "next";
import { NotFoundContent, notFoundMetadata } from "@/components/not-found-content";
import { isLocale } from "@/i18n/config";

/** Stejná stránka 404 pro každý neexistující web, bez nabídky jiných webů a bez slugu v textu. */
async function notFoundLocale() {
  const locale = await rootLocale();
  return locale && isLocale(locale) ? locale : "cs";
}

export async function generateMetadata(): Promise<Metadata> {
  return notFoundMetadata(await notFoundLocale());
}

export default async function TenantNotFound() {
  return <NotFoundContent locale={await notFoundLocale()} />;
}
