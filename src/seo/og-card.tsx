import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * Obrázek pro sdílení odkazu (Open Graph, 1200 × 630): WhatsApp, iMessage, Messenger, Slack, X a další
 * ho ukážou v náhledu. Kreslí se na serveru z textu (`next/og`), žádná fotografie ani osobní údaje hostů.
 * Písma jsou ta z PDF oznámení (`src/wizard/pdf/fonts`, do nasazení je přidává `outputFileTracingIncludes`),
 * takže diakritika sedí.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;

type FontName = "DMSans_400Regular.ttf" | "DMSans_700Bold.ttf" | "Newsreader_500Medium.ttf";
const fontCache = new Map<FontName, Promise<Buffer>>();

function font(name: FontName): Promise<Buffer> {
  let bytes = fontCache.get(name);
  if (!bytes) {
    bytes = readFile(join(process.cwd(), "src/wizard/pdf/fonts", name));
    fontCache.set(name, bytes);
  }
  return bytes;
}

export interface OgCardInput {
  /** Malý nadpis nahoře verzálkami („Budeme se brát“, „Blog“). */
  eyebrow: string;
  /** Hlavní text (jména páru, název článku). */
  title: string;
  /** Řádek pod ním (datum a místo); prázdný = bez řádku. */
  subtitle?: string;
  /** Patička vpravo dole (adresa webu, značka). */
  footer: string;
  colors: { bg: string; text: string; accent: string; muted: string; rule: string };
  /** Patkové písmo hlavního textu (Newsreader), jinak bezpatkové tučné (DM Sans, šablona Modern). */
  serif: boolean;
}

export async function ogCard(input: OgCardInput): Promise<ImageResponse> {
  const [serif, sans, sansBold] = await Promise.all([
    font("Newsreader_500Medium.ttf"),
    font("DMSans_400Regular.ttf"),
    font("DMSans_700Bold.ttf"),
  ]);
  const { colors } = input;
  const long = input.title.length > 34;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: colors.bg,
        color: colors.text,
        fontFamily: "DM Sans",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: 5,
            textTransform: "uppercase",
            color: colors.accent,
          }}
        >
          {input.eyebrow}
        </div>
        <div
          style={{
            marginTop: 28,
            fontFamily: input.serif ? "Newsreader" : "DM Sans",
            fontWeight: input.serif ? 500 : 700,
            fontSize: long ? 64 : 96,
            lineHeight: 1.05,
            letterSpacing: input.serif ? -1 : -2,
          }}
        >
          {input.title}
        </div>
        {input.subtitle ? (
          <div
            style={{
              marginTop: 32,
              paddingTop: 24,
              borderTop: `3px solid ${colors.text}`,
              fontSize: 36,
              fontFamily: input.serif ? "Newsreader" : "DM Sans",
            }}
          >
            {input.subtitle}
          </div>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          borderTop: `1px solid ${colors.rule}`,
          paddingTop: 20,
          fontSize: 24,
          color: colors.muted,
        }}
      >
        {input.footer}
      </div>
    </div>,
    {
      ...OG_SIZE,
      fonts: [
        { name: "Newsreader", data: serif, weight: 500, style: "normal" },
        { name: "DM Sans", data: sans, weight: 400, style: "normal" },
        { name: "DM Sans", data: sansBold, weight: 700, style: "normal" },
      ],
      // krátce: po zamčení nebo zrušení webu nesmí sdílená mezipaměť dlouho držet datum a místo
      headers: { "Cache-Control": "public, max-age=300, s-maxage=600" },
    },
  );
}
