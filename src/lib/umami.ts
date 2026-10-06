import "server-only";
import { headers } from "next/headers";
import { after } from "next/server";
import { clientIp } from "@/auth/request-info";
import { env } from "@/env";

/**
 * Serverové události do Umami (vlastní instance). Pageviews řeší klientský skript, tady jen akce, které se
 * v prohlížeči neměří (registrace, publikace, RSVP…). Funkce nikdy nehází a neblokuje odpověď: odeslání
 * běží přes `after()` s časovým limitem 3 s. Název kebab-case, `data` jen identifikátory, čísla a příznaky
 * (žádné e-maily, jména ani celé adresy; ADR 0007).
 */

type Value = string | number | boolean;

export interface ServerEvent {
  /** Krátký kebab-case název, nesmí začínat znakem `= + - @`. */
  name: string;
  data?: Record<string, Value>;
  /** Cesta, ke které událost patří (např. `/vytvorit`). Výchozí `/`. Referrer se neposílá: `Referer` Server Action může nést token z odkazu v e-mailu. */
  url?: string;
  /** Stabilní identifikátor pro volání bez požadavku (cron, webhook), ať se události spojí. */
  id?: string;
  /**
   * `true` (výchozí) vezme IP, User-Agent a jazyk z aktuálního požadavku návštěvníka;
   * `false` je pro cron a webhooky bez návštěvníka.
   */
  fromRequest?: boolean;
}

/** Bez návštěvníka (cron, webhook, anonymní RSVP) by bot filtr Umami zahodil UA serveru (`node`). */
const SERVER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export async function trackServerEvent(event: ServerEvent): Promise<void> {
  try {
    const base = env.NEXT_PUBLIC_UMAMI_URL?.replace(/\/+$/, "");
    const website = env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
    if (!base || !website || process.env.NODE_ENV !== "production") return;
    if (!NAME_RE.test(event.name)) {
      console.error("[umami] Neplatný název události");
      return;
    }

    const payload: Record<string, unknown> = {
      website,
      hostname: new URL(env.NEXT_PUBLIC_SITE_URL ?? "https://se-vezmou.cz").hostname,
      url: event.url ?? "/",
      name: event.name,
      data: event.data,
    };
    if (event.id) payload.id = event.id;
    if (event.fromRequest === false) {
      payload.userAgent = SERVER_UA;
    } else {
      const h = await headers();
      const ip = clientIp((name) => h.get(name), Boolean(env.VERCEL));
      if (ip !== "unknown") payload.ip = ip;
      const userAgent = h.get("user-agent");
      if (userAgent) payload.userAgent = userAgent;
      const language = h.get("accept-language")?.split(",")[0]?.trim();
      if (language) payload.language = language;
    }

    const endpoint = `${base}${env.UMAMI_COLLECT_ENDPOINT ?? "/api/send"}`;
    const body = JSON.stringify({ type: "event", payload });
    after(async () => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) console.error(`[umami] Odeslání události selhalo (HTTP ${res.status})`);
      } catch (error) {
        console.error(
          "[umami] Odeslání události selhalo",
          error instanceof Error ? error.name : error,
        );
      }
    });
  } catch (error) {
    console.error(
      "[umami] Událost se nepodařilo připravit",
      error instanceof Error ? error.name : error,
    );
  }
}
