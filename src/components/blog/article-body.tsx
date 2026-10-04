import { parseInline, type Block } from "@/blog/markdown";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/translator";
import { typo } from "@/i18n/typo";

/** Datum článku (`YYYY-MM-DD`) dlouze: „3. října 2026“, „3 October 2026“. */
export function articleDate(iso: string, locale: Locale): string {
  return formatDate(new Date(`${iso}T12:00:00Z`), locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const linkClass = "text-pine font-medium underline underline-offset-4 hover:bg-linen rounded-sm";

interface InlineProps {
  text: string;
  locale: Locale;
  /** Adresy článků, které ještě nejsou na webu: odkaz na ně se vykreslí jako text. */
  unpublished?: ReadonlySet<string>;
}

function Inline({ text, locale, unpublished }: InlineProps) {
  return parseInline(text).map((part, index) => {
    const content = typo(part.text, locale);
    if (part.type === "strong") return <strong key={index}>{content}</strong>;
    if (part.type === "link" && !unpublished?.has(part.href)) {
      const external = part.href.startsWith("https://");
      return (
        <a
          key={index}
          href={part.href}
          className={linkClass}
          {...(external ? { rel: "noopener", target: "_blank" } : {})}
        >
          {content}
        </a>
      );
    }
    return content;
  });
}

/** Text článku z bloků (`parseBlocks`): nadpisy s kotvami pro obsah článku, seznamy a tipy. */
export function ArticleBody({
  blocks,
  locale,
  unpublished,
}: {
  blocks: readonly Block[];
  locale: Locale;
  unpublished?: ReadonlySet<string>;
}) {
  return (
    <div className="text-ink flex flex-col gap-5 text-lg leading-relaxed">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "h2":
            return (
              <h2
                key={index}
                id={block.id}
                className="mt-8 scroll-mt-6 font-sans text-2xl leading-tight font-bold tracking-tight text-balance md:text-3xl"
              >
                {typo(block.text, locale)}
              </h2>
            );
          case "h3":
            return (
              <h3
                key={index}
                id={block.id}
                className="mt-4 scroll-mt-6 font-sans text-xl leading-snug font-bold"
              >
                {typo(block.text, locale)}
              </h3>
            );
          case "ul":
          case "ol": {
            const List = block.type;
            return (
              <List
                key={index}
                className={`flex flex-col gap-2 pl-6 ${block.type === "ul" ? "marker:text-cinnamon-deep list-disc" : "marker:text-pine list-decimal marker:font-bold"}`}
              >
                {block.items.map((item, i) => (
                  <li key={i} className="pl-1">
                    <Inline text={item} locale={locale} unpublished={unpublished} />
                  </li>
                ))}
              </List>
            );
          }
          case "quote":
            return (
              <p
                key={index}
                className="border-cinnamon bg-warm rounded-r-2xl border-l-4 px-6 py-5 text-pretty"
              >
                <Inline text={block.text} locale={locale} unpublished={unpublished} />
              </p>
            );
          default:
            return (
              <p key={index} className="text-pretty">
                <Inline text={block.text} locale={locale} unpublished={unpublished} />
              </p>
            );
        }
      })}
    </div>
  );
}
