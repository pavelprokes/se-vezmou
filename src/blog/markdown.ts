/**
 * Jednoduchý zápis textu článku (podmnožina Markdownu), aby šel článek psát v jednom poli
 * administrace. Blok je skupina řádků oddělená prázdným řádkem:
 *
 * - `## Nadpis` a `### Podnadpis`,
 * - `- položka` (odrážky) a `1. položka` (číslovaný seznam), každá položka na svém řádku,
 * - `> text` (zvýrazněný tip),
 * - tabulka (`| a | b |`, druhý řádek `| --- | --- |`),
 * - jinak odstavec (zalomení řádku uvnitř se spojí mezerou).
 *
 * Dva mezery na konci řádku zachovají zalomení. Číslovaná položka může pokračovat na dalších řádcích.
 * Uvnitř textu `**tučně**`, `` `kód` `` a `[text](/cesta)`; odkaz smí vést jen na `/…` nebo `https://…`.
 * Žádné HTML: text se vykresluje jako text, takže obsah nemůže vložit skript.
 */

export type Block =
  | { type: "h2" | "h3"; text: string; id: string }
  | { type: "p" | "quote"; text: string }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] };

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong" | "code"; text: string }
  | { type: "link"; text: string; href: string };

/** Kotva nadpisu: bez diakritiky, malá písmena, pomlčky (`Co na webu nesmí chybět` -> `co-na-webu-nesmi-chybet`). */
export function anchorId(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function stripAll(lines: string[], marker: RegExp): string[] {
  return lines.map((line) => line.replace(marker, "").trim());
}

/** Spojí řádky odstavce; dvě mezery na konci řádku zachovají zalomení (`\n`). */
function joinLines(raw: string[]): string {
  return raw
    .map((line, i) =>
      i < raw.length - 1 ? line.trim() + (/ {2,}$/.test(line) ? "\n" : " ") : line.trim(),
    )
    .join("");
}

function tableCells(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const chunks = source.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  for (const chunk of chunks) {
    const raw = chunk.split("\n").filter((line) => line.trim());
    const lines = raw.map((line) => line.trim());
    if (lines.length === 0) continue;
    const first = lines[0];
    const heading = /^(#{2,3}) (.+)$/.exec(first);
    if (heading && lines.length === 1) {
      const text = heading[2].trim();
      blocks.push({ type: heading[1] === "##" ? "h2" : "h3", text, id: anchorId(text) });
    } else if (lines.every((line) => /^- /.test(line))) {
      blocks.push({ type: "ul", items: stripAll(lines, /^- /) });
    } else if (lines.every((line) => /^\d+\. /.test(line))) {
      blocks.push({ type: "ol", items: stripAll(lines, /^\d+\. /) });
    } else if (/^\d+\. /.test(first)) {
      // položka číslovaného seznamu s pokračováním na dalších řádcích
      const text = joinLines(
        raw.map((line, i) => (i === 0 ? line.replace(/^\s*\d+\. /, "") : line)),
      );
      const last = blocks[blocks.length - 1];
      if (last?.type === "ol") last.items.push(text);
      else blocks.push({ type: "ol", items: [text] });
    } else if (lines.every((line) => /^>/.test(line))) {
      blocks.push({ type: "quote", text: stripAll(lines, /^>\s?/).join(" ") });
    } else if (
      lines.length >= 2 &&
      lines.every((line) => line.startsWith("|")) &&
      /^\|[\s:|-]+\|$/.test(lines[1])
    ) {
      blocks.push({
        type: "table",
        header: tableCells(lines[0]),
        rows: lines.slice(2).map(tableCells),
      });
    } else {
      blocks.push({ type: "p", text: joinLines(raw) });
    }
  }
  return blocks;
}

const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

function safeHref(href: string): boolean {
  return (href.startsWith("/") && !href.startsWith("//")) || href.startsWith("https://");
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) out.push({ type: "text", text: text.slice(last, match.index) });
    if (match[1] !== undefined) out.push({ type: "strong", text: match[1] });
    else if (match[2] !== undefined) out.push({ type: "code", text: match[2] });
    else if (safeHref(match[4])) out.push({ type: "link", text: match[3], href: match[4] });
    else out.push({ type: "text", text: match[3] });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

/** Čistý text bez značek (kontrola typografie, odhad délky). */
export function plainText(source: string): string[] {
  return parseBlocks(source)
    .flatMap((block) =>
      block.type === "table"
        ? [...block.header, ...block.rows.flat()]
        : "items" in block
          ? block.items
          : [block.text],
    )
    .map((text) =>
      parseInline(text)
        .map((part) => part.text)
        .join(""),
    );
}
