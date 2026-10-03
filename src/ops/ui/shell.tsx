import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { localePath, locales, type Locale } from "@/i18n/config";
import type { NamespaceKey } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { logoutAction } from "../actions/login";
import { getOpsTranslator } from "../i18n";
import { can, type OperatorAction } from "../roles";
import type { OperatorSession } from "../session";

export type NavKey = "overview" | "weddings" | "retention" | "audit" | "operators" | "account";

const NAV: { key: NavKey; href: string; action: OperatorAction; label: NamespaceKey<"ops"> }[] = [
  { key: "overview", href: "/", action: "view", label: "ops.nav.overview" },
  { key: "weddings", href: "/zakazky", action: "view", label: "ops.nav.weddings" },
  { key: "retention", href: "/retence", action: "view", label: "ops.nav.retention" },
  { key: "audit", href: "/audit", action: "audit", label: "ops.nav.audit" },
  { key: "operators", href: "/operatori", action: "manage_operators", label: "ops.nav.operators" },
  { key: "account", href: "/ucet", action: "view", label: "ops.nav.account" },
];

/**
 * Rámec přihlášených stránek administrace: hlavička s nabídkou (aktuální stránka je označená
 * `aria-current`), hlavní oblast s nadpisem první úrovně, přepínač jazyka a odhlášení. Odkazy nesou
 * jazyk stránky (výchozí bez předpony, ostatní pod `/<jazyk>`).
 */
export async function OpsShell({
  session,
  current,
  path,
  title,
  children,
}: {
  session: OperatorSession;
  current: NavKey;
  /** Cesta obrazovky bez předpony jazyka pro přepínač; výchozí je položka nabídky `current`. */
  path?: string;
  title: string;
  children: ReactNode;
}) {
  const t = await getOpsTranslator();
  const { locale } = t;
  const here = path ?? NAV.find((item) => item.key === current)?.href ?? "/";
  const hrefs = Object.fromEntries(locales.map((l) => [l, localePath(here, l)])) as Record<
    Locale,
    string
  >;
  return (
    <>
      <header className="border-hairline bg-warm border-b">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-ink font-serif text-xl font-medium">{t("ops.brand")}</p>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-muted text-sm">
                {t("ops.shell.signedIn", {
                  email: session.email,
                  role: t(session.role === "owner" ? "ops.role.owner" : "ops.role.support"),
                })}
              </p>
              <LanguageSwitcher current={locale} hrefs={hrefs} label={t("common.language.label")} />
              <form action={logoutAction}>
                <Button type="submit" variant="secondary">
                  {t("ops.shell.logout")}
                </Button>
              </form>
            </div>
          </div>
          <nav aria-label={t("ops.nav.label")}>
            <ul className="flex flex-wrap gap-x-2 gap-y-1">
              {NAV.filter((item) => can(session.role, item.action)).map((item) => (
                <li key={item.key}>
                  <a
                    href={localePath(item.href, locale)}
                    aria-current={item.key === current ? "page" : undefined}
                    className={cn(
                      "min-h-target rounded-button inline-flex items-center px-3 py-2 text-base font-medium underline-offset-4",
                      item.key === current
                        ? "bg-pine text-parchment"
                        : "text-pine hover:bg-linen underline",
                    )}
                  >
                    {t(item.label)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <main id="obsah" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8">
        <h1 className="text-ink mb-6 text-3xl font-medium sm:text-4xl">{title}</h1>
        {children}
      </main>
    </>
  );
}

/** Nadpis sekce uvnitř stránky (druhá úroveň). */
export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-ink mb-3 text-2xl font-medium">
      {children}
    </h2>
  );
}

/** Tabulka v oblasti, kterou jde na úzkém displeji posouvat a ovládat klávesnicí (WCAG 1.4.10, 2.1.1). */
export function TableRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="border-hairline rounded-button overflow-x-auto border"
    >
      {children}
    </div>
  );
}

export const tableClass = "w-full min-w-[40rem] border-collapse text-left text-base";
export const thClass = "bg-linen text-ink border-hairline border-b px-3 py-2 text-sm font-medium";
export const tdClass = "border-hairline border-b px-3 py-2 align-top";
