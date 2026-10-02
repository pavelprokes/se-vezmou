import { env } from "@/env";

/** Kanonická adresa úvodní stránky (bez lomítka na konci). */
export const siteUrl = env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");

/** Adresa průvodce a správy (`app.se-vezmou.cz`, bez lomítka na konci), z konfigurace `NEXT_PUBLIC_APP_URL`. */
export const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
