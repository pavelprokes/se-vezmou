import { RESERVED_SLUGS } from "@/config/reserved-slugs";

/**
 * Určení druhu hostitele z hlavičky `Host` (ADR 0002). Čistá funkce bez I/O a bez `next/*`.
 */

export type HostKind = "marketing" | "app" | "admin" | "tenant";

export type HostResolution =
  { kind: "marketing" | "app" | "admin" } | { kind: "tenant"; slug: string } | { kind: "invalid" };

export interface HostConfig {
  /** Kořenové domény (`se-vezmou.cz`, lokálně `localhost`), malými písmeny. */
  rootDomains: readonly string[];
  /** Předvolba druhu hostitele pro náhledy mimo kořenovou doménu; v produkci je vždy `undefined`. */
  preset?: HostKind;
  previewTenantSlug?: string;
}

const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const HOST_PATTERN = /^[a-z0-9.-]+$/;

/** Slug adresy webu páru: DNS štítek bez `--` a mimo rezervovaná slova. */
export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !slug.includes("--") && !RESERVED_SLUGS.includes(slug);
}

/** Odstraní port, převede na malá písmena a zahodí tečku na konci; neplatné hodnoty vrátí `null`. */
export function normalizeHost(header: string | null | undefined): string | null {
  if (!header) return null;
  const host = header
    .trim()
    .toLowerCase()
    .replace(/:\d{1,5}$/, "")
    .replace(/\.$/, "");
  return host !== "" && HOST_PATTERN.test(host) && !host.includes("..") ? host : null;
}

/** Sestaví konfiguraci z proměnných prostředí. Předvolby produkce nikdy nečte. */
export function hostConfigFromEnv(
  env: Record<string, string | undefined>,
  options: { development?: boolean } = {},
): HostConfig {
  const root = (env.ROOT_DOMAIN || "se-vezmou.cz").trim().toLowerCase();
  const rootDomains = options.development && root !== "localhost" ? [root, "localhost"] : [root];

  const isProduction = env.VERCEL_ENV === "production";
  const preset = env.HOST_PRESET as HostKind | undefined;
  const validPreset =
    !isProduction && preset && ["marketing", "app", "admin", "tenant"].includes(preset);

  return {
    rootDomains,
    preset: validPreset ? preset : undefined,
    previewTenantSlug: validPreset ? env.PREVIEW_TENANT_SLUG || undefined : undefined,
  };
}

export function resolveHost(header: string | null | undefined, config: HostConfig): HostResolution {
  const host = normalizeHost(header);
  if (!host) return { kind: "invalid" };

  for (const root of config.rootDomains) {
    if (host === root) return { kind: "marketing" };
    if (!host.endsWith(`.${root}`)) continue;

    const label = host.slice(0, -(root.length + 1));
    // Víceúrovňové subdomény (`a.b.se-vezmou.cz`) neexistují.
    if (label.includes(".")) return { kind: "invalid" };
    // `www.` je stejná úvodní stránka; které z obou jmen je hlavní, určuje přesměrování domény ve Vercelu
    // (aplikace nepřesměrovává, aby nevznikla smyčka s tímto nastavením) a kanonická adresa v metadatech.
    if (label === "www") return { kind: "marketing" };
    if (label === "app") return { kind: "app" };
    if (label === "admin") return { kind: "admin" };
    return isValidSlug(label) ? { kind: "tenant", slug: label } : { kind: "invalid" };
  }

  // Host mimo kořenovou doménu (náhled na `*.vercel.app`): jen s předvolbou.
  if (config.preset === "tenant") {
    const slug = config.previewTenantSlug;
    return slug && isValidSlug(slug) ? { kind: "tenant", slug } : { kind: "invalid" };
  }
  if (config.preset) return { kind: config.preset };
  return { kind: "invalid" };
}
