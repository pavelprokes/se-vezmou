import type { Metadata } from "next";
import { Lightbulb } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Icon } from "@/components/ui/icon";
import { typo } from "@/i18n/typo";
import { siteUrl } from "@/lib/site";
import { GUIDE, GUIDE_LEAD, GUIDE_TITLE, type GuideBlock } from "./content";

export const metadata: Metadata = {
  title: GUIDE_TITLE,
  description: GUIDE_LEAD,
  // `noindex` dědí z layoutu hostitele app, tady pro jistotu výslovně (stránka se posílá e-mailem)
  robots: { index: false, follow: false },
};

/** Text s `**tučnými**` popisky tlačítek; česká typografie (nezlomitelné mezery) na každý kus textu. */
function Rich({ text }: { text: string }) {
  return text
    .split("**")
    .map((part, i) =>
      i % 2 === 1 ? <strong key={i}>{typo(part, "cs")}</strong> : typo(part, "cs"),
    );
}

function Block({ block }: { block: GuideBlock }) {
  if ("h3" in block) {
    return <h3 className="text-ink mt-4 text-xl font-semibold">{typo(block.h3, "cs")}</h3>;
  }
  if ("steps" in block || "list" in block) {
    const items = "steps" in block ? block.steps : block.list;
    const List = "steps" in block ? "ol" : "ul";
    return (
      <List
        className={`flex flex-col gap-2 pl-6 ${"steps" in block ? "list-decimal" : "list-disc"}`}
      >
        {items.map((item) => (
          <li key={item} className="pl-1">
            <Rich text={item} />
          </li>
        ))}
      </List>
    );
  }
  if ("tip" in block) {
    return (
      <p className="border-hairline bg-warm flex gap-3 rounded-2xl border p-4">
        <Icon icon={Lightbulb} className="text-pine mt-1 shrink-0" />
        <span>
          <Rich text={block.tip} />
        </span>
      </p>
    );
  }
  return (
    <p>
      <Rich text={block.p} />
    </p>
  );
}

/**
 * Veřejný návod pro páry (`app.se-vezmou.cz/navod`): bez přihlášení, posílá se klientům e-mailem
 * a odkazuje na něj průvodce i správa. Jen česky; na `/en/navod` je stejný český text (`lang="cs"`).
 * Hostitel app se neindexuje (robots.txt i `noindex`).
 */
export default function GuidePage() {
  return (
    <>
      <header className="border-hairline border-b px-4 py-3 sm:px-8">
        <a href={siteUrl} className="min-h-target text-ink inline-flex items-center text-xl">
          <BrandLogo />
        </a>
      </header>
      <main
        id="obsah"
        tabIndex={-1}
        lang="cs"
        className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 text-lg leading-relaxed sm:px-8"
      >
        <h1 className="text-ink text-3xl font-medium sm:text-5xl">{typo(GUIDE_TITLE, "cs")}</h1>
        <p className="text-muted mt-4 text-xl">{typo(GUIDE_LEAD, "cs")}</p>

        <nav aria-labelledby="navod-obsah" className="border-hairline mt-8 rounded-2xl border p-5">
          <h2 id="navod-obsah" className="text-ink text-xl font-semibold">
            Obsah
          </h2>
          <ol className="mt-3 flex list-decimal flex-col gap-1 pl-6">
            {GUIDE.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="min-h-target text-pine inline-flex items-center underline underline-offset-4"
                >
                  {typo(section.title, "cs")}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {GUIDE.map((section, index) => (
          <section
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-nadpis`}
            className="mt-12 flex scroll-mt-6 flex-col gap-4"
          >
            <h2 id={`${section.id}-nadpis`} className="text-ink text-2xl font-medium sm:text-3xl">
              {index + 1}. {typo(section.title, "cs")}
            </h2>
            {section.blocks.map((block, i) => (
              <Block key={i} block={block} />
            ))}
            <p>
              <a href="#navod-obsah" className="text-pine text-base underline underline-offset-4">
                Zpět na obsah
              </a>
            </p>
          </section>
        ))}
      </main>
    </>
  );
}
