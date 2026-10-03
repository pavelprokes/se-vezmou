import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { namespaces, type Namespace } from "./messages";

/**
 * Hlídání načítání překladů po jmenných prostorech (ADR 0013):
 *
 * 1. Žádný soubor v `src` neimportuje `messages/<jazyk>/*.json` staticky, kromě loaderu
 *    (`src/i18n/load.ts`, jen dynamický `import()`), typů (`src/i18n/messages.ts`, jen `import type`)
 *    a textů chyby kořenového layoutu (`src/i18n/error-messages.ts`, jen `errors.json`).
 * 2. Stránka načítá jen jmenné prostory, které deklaruje její strom modulů: úvodní stránka žádné
 *    texty správy, průvodce ani provozu, stránka správy žádné texty úvodní stránky ani provozu.
 *    Strom se prochází přes statické importy (nadhodnocuje, nikdy nepodhodnocuje) a každé volání
 *    `getTranslator`/`loadMessages`/`pickMessages` v `src` musí jmenné prostory uvádět výčtem nebo
 *    známou konstantou, jinak test selže (analýza by nebyla spolehlivá).
 */

const SRC = resolve(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mts|js|mjs)$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(SRC);
const rel = (path: string) => relative(SRC, path).replaceAll("\\", "/");

/** Zdrojový kód bez komentářů (příklady v dokumentaci nejsou volání). */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("statické importy překladů", () => {
  const MESSAGE_IMPORT =
    /(^\s*import\s+(type\s+)?[^;"']*?from\s*|import\s*\(\s*|require\s*\(\s*)["']([^"']*messages\/[a-z]{2,3}(?:-[A-Za-z]+)?\/[^"']+\.json)["']/gm;

  it("jen loader, typy a texty chyby kořenového layoutu sahají na soubory zpráv", () => {
    const violations: string[] = [];
    for (const file of files) {
      const name = rel(file);
      if (name === "i18n/imports.test.ts") continue;
      for (const match of code(file).matchAll(MESSAGE_IMPORT)) {
        const [, how, typeOnly, target] = match;
        const dynamic = how.trim().startsWith("import(") || /^import\s*\(/.test(how);
        const ok =
          (name === "i18n/load.ts" && dynamic) ||
          (name === "i18n/messages.ts" && Boolean(typeOnly)) ||
          (name === "i18n/error-messages.ts" && !dynamic && target.endsWith("/errors.json"));
        if (!ok) violations.push(`${name}: ${match[0]}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("loader má pro každý jazyk a jmenný prostor právě jeden dynamický import", () => {
    const code = readFileSync(join(SRC, "i18n/load.ts"), "utf8");
    const imports = [...code.matchAll(/import\("\.\/messages\/([^/]+)\/([^"]+)\.json"\)/g)].map(
      (m) => `${m[1]}/${m[2]}`,
    );
    expect(new Set(imports).size).toBe(imports.length);
    expect(imports.length).toBeGreaterThanOrEqual(namespaces.length);
  });
});

// --- Strom modulů stránky a jmenné prostory ---

const CALL =
  /\b(getTranslator|loadMessages|pickMessages)\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*([^)]*?)\s*\)/g;

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile() && /\.(ts|tsx)$/.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

function importsOf(file: string): string[] {
  const specs = [
    ...code(file).matchAll(/(?:import|export)\s+(?!type\s)[^;]*?from\s*["']([^"']+)["']/g),
  ].map((m) => m[1]);
  return specs.map((spec) => resolveImport(file, spec)).filter((p): p is string => p !== null);
}

/** Konstanty se seznamem jmenných prostorů (`SITE_NAMESPACES`, `OPS_NAMESPACES`). */
const constants = new Map<string, Namespace[]>();
for (const file of files) {
  for (const m of code(file).matchAll(/export const (\w+_NAMESPACES) = \[([^\]]*)\] as const/g)) {
    constants.set(
      m[1],
      [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1] as Namespace),
    );
  }
}

function namespacesIn(file: string): { found: Namespace[]; unresolved: string[] } {
  const found: Namespace[] = [];
  const unresolved: string[] = [];
  // Loader sám jmenné prostory nevybírá, jen předává ty od volajícího.
  if (rel(file) === "i18n/load.ts") return { found, unresolved };
  for (const m of code(file).matchAll(CALL)) {
    const arg = m[2].trim();
    if (arg.startsWith("[")) {
      found.push(...[...arg.matchAll(/"([^"]+)"/g)].map((x) => x[1] as Namespace));
    } else if (constants.has(arg)) {
      found.push(...(constants.get(arg) ?? []));
    } else {
      unresolved.push(`${rel(file)}: ${m[0]}`);
    }
  }
  return { found, unresolved };
}

function routeNamespaces(roots: string[]): Set<Namespace> {
  const seen = new Set<string>();
  const queue = roots.map((root) => join(SRC, root));
  const result = new Set<Namespace>();
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    namespacesIn(file).found.forEach((ns) => result.add(ns));
    queue.push(...importsOf(file));
  }
  return result;
}

describe("jmenné prostory podle stránek", () => {
  it("každé volání loaderu v src uvádí jmenné prostory výčtem nebo známou konstantou", () => {
    const unresolved = files
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .flatMap((file) => namespacesIn(file).unresolved);
    expect(unresolved).toEqual([]);
    for (const list of constants.values()) {
      for (const ns of list) expect(namespaces).toContain(ns);
    }
  });

  it("úvodní stránka nenačítá texty správy, průvodce ani provozu", () => {
    const loaded = routeNamespaces([
      "app/h/marketing/[locale]/layout.tsx",
      "app/h/marketing/[locale]/page.tsx",
      "app/h/marketing/[locale]/not-found.tsx",
    ]);
    expect([...loaded].sort()).toEqual(["common", "errors", "landing", "marketing"]);
    for (const ns of ["admin", "admin.guests", "ops", "wizard"] as const) {
      expect(loaded.has(ns), ns).toBe(false);
    }
  });

  it("právní stránka načítá jen rámec, právní texty a hlavičku úvodní stránky", () => {
    const loaded = routeNamespaces([
      "app/h/marketing/[locale]/layout.tsx",
      "app/h/marketing/[locale]/soukromi/page.tsx",
    ]);
    for (const ns of ["admin", "admin.guests", "ops", "wizard", "site", "rsvp"] as const) {
      expect(loaded.has(ns), ns).toBe(false);
    }
    expect(loaded.has("legal")).toBe(true);
  });

  it("stránka správy nenačítá texty úvodní stránky ani provozu", () => {
    const loaded = routeNamespaces(["app/h/app/layout.tsx", "app/h/app/(sprava)/web/page.tsx"]);
    for (const ns of ["landing", "marketing", "legal", "ops"] as const) {
      expect(loaded.has(ns), ns).toBe(false);
    }
    expect(loaded.has("admin")).toBe(true);
  });

  it("přihlášení správce načítá jen rámec a texty přihlášení", () => {
    const loaded = routeNamespaces(["app/h/app/layout.tsx", "app/h/app/prihlaseni/page.tsx"]);
    expect([...loaded].sort()).toEqual(["auth", "common"]);
  });

  it("provozní administrace nenačítá texty úvodní stránky, správy ani průvodce", () => {
    const loaded = routeNamespaces(["app/h/admin/layout.tsx", "app/h/admin/page.tsx"]);
    for (const ns of ["landing", "marketing", "admin", "admin.guests", "wizard"] as const) {
      expect(loaded.has(ns), ns).toBe(false);
    }
    expect(loaded.has("ops")).toBe(true);
  });

  it("web páru načítá jen rámec a texty webu", () => {
    const loaded = routeNamespaces([
      "app/h/tenant/[slug]/[locale]/layout.tsx",
      "app/h/tenant/[slug]/[locale]/page.tsx",
    ]);
    expect([...loaded].sort()).toEqual(["common", "rsvp", "site"]);
  });
});
