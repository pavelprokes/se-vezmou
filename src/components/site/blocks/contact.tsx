import { Mail, Phone } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import type { BlockOf } from "@/site/types";
import type { SiteCtx } from "../context";
import { Section } from "./section";

/** Kontakty na osoby, které pár uvedl (jméno, role, e-mail, telefon); odkazy `mailto:` a `tel:`. */
export function Contact({
  block,
  ctx,
  tone,
}: {
  block: BlockOf<"contact">;
  ctx: SiteCtx;
  tone: "bg" | "surface";
}) {
  const { t } = ctx;
  return (
    <Section block={block} ctx={ctx} tone={tone}>
      <div className="site-cards">
        {block.data.people.map((person) => (
          <article key={person.id} className="site-card" aria-labelledby={`contact-${person.id}`}>
            <h3 id={`contact-${person.id}`} className="site-h3">
              {person.name}
            </h3>
            {person.role ? (
              <p className="site-muted" lang={ctx.lang(person.role)}>
                {ctx.text(person.role)}
              </p>
            ) : null}
            <ul className="site-contact-list">
              {person.email ? (
                <li>
                  <a href={`mailto:${person.email}`} className="site-link">
                    <Icon icon={Mail} label={t("site.contact.email")} />
                    {person.email}
                  </a>
                </li>
              ) : null}
              {person.phone ? (
                <li>
                  <a href={`tel:${person.phone.replace(/\s+/g, "")}`} className="site-link">
                    <Icon icon={Phone} label={t("site.contact.phone")} />
                    {person.phone}
                  </a>
                </li>
              ) : null}
            </ul>
          </article>
        ))}
      </div>
    </Section>
  );
}
