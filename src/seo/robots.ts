import { ALLOWED_BOTS, LINK_PREVIEW_BOTS, TRAINING_BOTS } from "@/config/robots";

function group(agents: readonly string[], rule: string): string {
  return [...agents.map((agent) => `User-agent: ${agent}`), rule].join("\n");
}

/** `robots.txt` úvodní stránky: vyhledávací a odpovědní roboty ano, trénování modelů ne. */
export function marketingRobots(siteUrl: string): string {
  return (
    [
      group(ALLOWED_BOTS, "Allow: /"),
      group(TRAINING_BOTS, "Disallow: /"),
      group(["*"], "Allow: /"),
      `Sitemap: ${new URL("/sitemap.xml", siteUrl).toString()}`,
    ].join("\n\n") + "\n"
  );
}

/** `robots.txt` pro `app.`, `admin.` a weby párů: nikdo nic neindexuje. */
export function closedRobots(): string {
  return "User-agent: *\nDisallow: /\n";
}

/** `robots.txt` webu páru: náhledy sdílených odkazů ano (WhatsApp, Messenger…), jinak nikdo; web je `noindex`. */
export function tenantRobots(): string {
  return [group(LINK_PREVIEW_BOTS, "Allow: /"), group(["*"], "Disallow: /")].join("\n\n") + "\n";
}

export function robotsResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
