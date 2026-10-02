import { composeEmail, formatMoment, formatPause, type Block, type RenderedEmail } from "./shared";

/**
 * E-maily operátorům provozní administrace (docs/adr/0012). Operátorské rozhraní je jen česky, proto
 * jen česká verze. Kód je na samostatném řádku, aby šel vložit ze schránky (WCAG 3.3.8).
 */

const BRAND = "Se vezmou, provozní administrace";

export type OperatorCodeParams = { code: string; ttlSeconds: number };

export function renderOperatorCode({ code, ttlSeconds }: OperatorCodeParams): RenderedEmail {
  const blocks: Block[] = [
    { kind: "heading", text: "Přihlášení do provozní administrace" },
    { kind: "paragraph", text: "Váš přihlašovací kód:" },
    { kind: "code", text: code },
    {
      kind: "paragraph",
      text: `Kód platí ${formatPause(ttlSeconds, "cs")} a jde použít jen jednou. Po něm vás ještě požádáme o kód z aplikace pro druhý faktor.`,
    },
    {
      kind: "small",
      text: "Pokud jste o přihlášení nežádali, tuto zprávu ignorujte a dejte vědět majiteli. Kód nikomu nesdělujte.",
    },
  ];
  return composeEmail("cs", "Přihlašovací kód do provozní administrace", blocks, BRAND);
}

export type OperatorNoticeParams = {
  event: "login" | "backup_code" | "backup_codes_regenerated";
  at: Date;
  /** U `backup_code`: kolik záložních kódů zbývá. */
  remaining?: number;
};

const HEADINGS = {
  login: "Přihlášení do provozní administrace",
  backup_code: "Použit záložní kód",
  backup_codes_regenerated: "Vygenerována nová sada záložních kódů",
} as const;

export function renderOperatorNotice({
  event,
  at,
  remaining,
}: OperatorNoticeParams): RenderedEmail {
  const when = formatMoment(at, "cs");
  const blocks: Block[] = [{ kind: "heading", text: HEADINGS[event] }];
  if (event === "login") {
    blocks.push({
      kind: "paragraph",
      text: `Do provozní administrace se ${when} přihlásil někdo pod vaším účtem.`,
    });
  } else if (event === "backup_code") {
    blocks.push({
      kind: "paragraph",
      text: `Při přihlášení ${when} byl použit záložní kód. Zbývá ${remaining ?? 0} nepoužitých kódů.`,
    });
    blocks.push({
      kind: "paragraph",
      text: "Záložní kód slouží jen jako nouzová cesta, když nemáte aplikaci pro druhý faktor. Nová sada kódů se dá vytvořit v nastavení účtu.",
    });
  } else {
    blocks.push({
      kind: "paragraph",
      text: `Dne ${when} byla vygenerována nová sada záložních kódů. Staré kódy přestaly platit.`,
    });
  }
  blocks.push({
    kind: "small",
    text: "Pokud jste to nebyli vy, ihned to nahlaste majiteli. Ten vám druhý faktor zneplatní a ukončí otevřené relace.",
  });
  return composeEmail("cs", HEADINGS[event], blocks, BRAND);
}
