import "server-only";
import { currentHostConfig } from "@/auth/app-origin";
import { getHost } from "@/auth/request";
import type { Locale } from "@/i18n/config";
import { displayHost, siteUrl } from "@/wizard/urls";

/** Adresa zveřejněného webu páru (podle hostitele `app.`, na kterém správce je) a její zkrácený zápis. */
export async function liveSite(
  slug: string | null,
  locale: Locale,
): Promise<{ url: string; host: string } | null> {
  if (!slug) return null;
  const host = await getHost();
  const root = currentHostConfig().rootDomains[0];
  return { url: siteUrl(slug, host, locale, root), host: displayHost(slug, host, root) };
}
