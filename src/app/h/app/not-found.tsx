import type { Metadata } from "next";
import { getUiLocale } from "@/auth/request";
import { NotFoundContent, notFoundMetadata } from "@/components/not-found-content";

export async function generateMetadata(): Promise<Metadata> {
  return notFoundMetadata(await getUiLocale());
}

export default async function AppNotFound() {
  return <NotFoundContent locale={await getUiLocale()} />;
}
