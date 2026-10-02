/** Pomocníci pro hostitele v e2e testech (`*.localhost`, ROOT_DOMAIN=localhost). */

export const PORT = Number(process.env.E2E_PORT ?? 3100);

export const HOSTS = {
  marketing: "localhost",
  app: "app.localhost",
  admin: "admin.localhost",
  tenant: "klara-a-matej.localhost",
} as const;

export type HostName = keyof typeof HOSTS;

/** Adresa pro prohlížeč: `http://app.localhost:3100/cesta`. */
export function pageUrl(host: string, path = "/"): string {
  return `http://${host}:${PORT}${path}`;
}

/**
 * Adresa pro API klienta Playwrightu. Spojení jde na 127.0.0.1 a hostitele nese hlavička `Host`,
 * takže test nezávisí na překladu jmen v Node.js.
 */
export function apiRequest(host: string, path = "/") {
  return {
    url: `http://127.0.0.1:${PORT}${path}`,
    options: {
      headers: { host: `${host}:${PORT}` },
      maxRedirects: 0,
    },
  };
}
