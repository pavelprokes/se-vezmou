/**
 * Kontrola překladů a typografie: `npm run i18n:check` (součást CI).
 * Čte JSON ze `src/i18n/messages/<jazyk>/<jmenný prostor>.json`, volá `checkMessages`
 * a při chybě skončí s kódem 1. Nepoužité klíče jsou jen varování.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { checkMessages, type FlatCatalogs } from "../src/i18n/check";
import { locales } from "../src/i18n/config";
import type { MessageValue } from "../src/i18n/format";

const root = join(import.meta.dirname, "..");
const messagesDir = join(root, "src/i18n/messages");

function loadCatalogs(): FlatCatalogs {
  const catalogs = { cs: {}, en: {} } as FlatCatalogs;
  for (const locale of locales) {
    const dir = join(messagesDir, locale);
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
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
  return new Set(Object.keys(catalogs.cs).filter((key) => code.includes(`"${key}"`)));
}

const catalogs = loadCatalogs();
const { errors, warnings } = checkMessages(catalogs, usedKeys(catalogs));

for (const warning of warnings) console.warn(`varování: ${warning}`);
for (const error of errors) console.error(`chyba: ${error}`);

const count = Object.keys(catalogs.cs).length;
if (errors.length > 0) {
  console.error(`\ni18n:check selhala (${errors.length} chyb, ${relative(root, messagesDir)}).`);
  process.exit(1);
}
console.log(`i18n:check v pořádku (${count} klíčů, ${locales.join(" + ")}).`);
