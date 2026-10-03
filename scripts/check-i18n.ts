/**
 * Kontrola překladů a typografie: `npm run i18n:check` (součást CI).
 * Čte JSON ze `src/i18n/messages/<jazyk>/<jmenný prostor>.json` pro všechny jazyky z `locales`,
 * ověří, že každý jazyk má právě jmenné prostory ze `src/i18n/messages.ts`, porovná každý jazyk
 * s výchozím (`checkMessages`) a při chybě skončí s kódem 1. Nepoužité klíče jsou jen varování.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { checkMessages, type FlatCatalogs } from "../src/i18n/check";
import { defaultLocale, locales } from "../src/i18n/config";
import type { MessageValue } from "../src/i18n/format";
import { namespaces } from "../src/i18n/messages";

const root = join(import.meta.dirname, "..");
const messagesDir = join(root, "src/i18n/messages");

const fileErrors: string[] = [];

function loadCatalogs(): FlatCatalogs {
  const catalogs = Object.fromEntries(locales.map((locale) => [locale, {}])) as FlatCatalogs;
  for (const locale of locales) {
    const dir = join(messagesDir, locale);
    const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
    const present = new Set(files.map((file) => file.replace(/\.json$/, "")));
    for (const namespace of namespaces) {
      if (!present.has(namespace)) fileErrors.push(`[${locale}] chybí soubor ${namespace}.json`);
    }
    for (const namespace of present) {
      if (!(namespaces as readonly string[]).includes(namespace)) {
        fileErrors.push(`[${locale}] soubor ${namespace}.json není v seznamu jmenných prostorů`);
      }
    }
    for (const file of files) {
      const namespace = file.replace(/\.json$/, "");
      const entries = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<
        string,
        MessageValue
      >;
      for (const [key, value] of Object.entries(entries)) {
        catalogs[locale][`${namespace}.${key}`] = value;
      }
    }
  }
  return catalogs;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "messages" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

function usedKeys(catalogs: FlatCatalogs): Set<string> {
  const code = sourceFiles(join(root, "src"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  return new Set(Object.keys(catalogs[defaultLocale]).filter((key) => code.includes(`"${key}"`)));
}

const catalogs = loadCatalogs();
const result = checkMessages(catalogs, usedKeys(catalogs));
const errors = [...fileErrors, ...result.errors];
const { warnings } = result;

for (const warning of warnings) console.warn(`varování: ${warning}`);
for (const error of errors) console.error(`chyba: ${error}`);

const count = Object.keys(catalogs[defaultLocale]).length;
if (errors.length > 0) {
  console.error(`\ni18n:check selhala (${errors.length} chyb, ${relative(root, messagesDir)}).`);
  process.exit(1);
}
console.log(`i18n:check v pořádku (${count} klíčů, ${locales.join(" + ")}).`);
