import { isLocalHost } from "@/auth/cookie";
import { resolveHost, type HostConfig } from "@/host/resolve";

/**
 * Adresy ostatních hostitelů odvozené z hostitele, na kterém běží administrace (`admin.`). Nikdy nevycházejí
 * z hodnoty, kterou poslal klient: hlavička `Host` musí být rozpoznaná jako `admin.`, jinak se použije kořenová
 * doména z nastavení. Lokálně (`*.localhost`) se zachová port a schéma `http`. Čistý modul.
 */

export function siblingOrigin(
  subdomain: string,
  hostHeader: string | null | undefined,
  config: HostConfig,
): string {
  const host = hostHeader?.trim().toLowerCase();
  if (host && resolveHost(host, config).kind === "admin") {
    return `${isLocalHost(host) ? "http" : "https"}://${subdomain}.${host.replace(/^admin\./, "")}`;
  }
  return `https://${subdomain}.${config.rootDomains[0]}`;
}

/** Adresa správy páru (`app.`) pro odkazy v e-mailech. */
export function appOriginForAdminHost(
  hostHeader: string | null | undefined,
  config: HostConfig,
): string {
  return siblingOrigin("app", hostHeader, config);
}

/** Adresa zveřejněného webu páru (`klara-a-matej.se-vezmou.cz`). */
export function siteOriginForAdminHost(
  slug: string,
  hostHeader: string | null | undefined,
  config: HostConfig,
): string {
  return siblingOrigin(slug, hostHeader, config);
}
