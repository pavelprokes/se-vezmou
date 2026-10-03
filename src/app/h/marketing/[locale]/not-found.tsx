import { locale as rootLocale } from "next/root-params";
import type { Metadata } from "next";
import { NotFoundContent, notFoundMetadata } from "@/components/not-found-content";
import { isLocale } from "@/i18n/config";

async function notFoundLocale() {
  const locale = await rootLocale();
  return locale && isLocale(locale) ? locale : "cs";
}

export async function generateMetadata(): Promise<Metadata> {
  return notFoundMetadata(await notFoundLocale());
}

export default async function MarketingNotFound() {
  return <NotFoundContent locale={await notFoundLocale()} />;
}
