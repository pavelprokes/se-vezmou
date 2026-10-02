import { env } from "@/env";

/** Kanonická adresa úvodní stránky (bez lomítka na konci). */
export const siteUrl = env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
