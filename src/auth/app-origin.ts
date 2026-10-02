import { hostConfigFromEnv, resolveHost, type HostConfig } from "@/host/resolve";
import { isLocalHost } from "./cookie";

/**
 * Adresy pro odkazy v e-mailech. Odkaz míří vždy na hostitele `app.` (nikdy na adresu, kterou
 * poslal klient): hlavička `Host` se použije jen tehdy, když ji `resolveHost` pozná jako `app.`;
 * jinak se sestaví z kořenové domény. Čistý modul.
 */

export function appOrigin(hostHeader: string | null | undefined, config: HostConfig): string {
  if (hostHeader && resolveHost(hostHeader, config).kind === "app") {
    return `${isLocalHost(hostHeader) ? "http" : "https"}://${hostHeader.trim().toLowerCase()}`;
  }
  return `https://app.${config.rootDomains[0]}`;
}

/** Adresa webu páru pro popis v e-mailu (`klara-a-matej.se-vezmou.cz`), bez schématu. */
export function siteHostname(slug: string, config: HostConfig): string {
  return `${slug}.${config.rootDomains[0]}`;
}

export function currentHostConfig(): HostConfig {
  return hostConfigFromEnv(process.env, { development: process.env.NODE_ENV !== "production" });
}
