import type { CSSProperties } from "react";
import { ArrowDown, ArrowUpRight, ExternalLink, Lock, Mail, Phone } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { formatDateRange } from "@/site/format";
import { googleMapsUrl, mapyCzUrl } from "@/site/map/view";
import { buildSpayd } from "@/site/payment";
import type { SurfaceKey } from "@/site/themes/palettes";
import type { BlockOf } from "@/site/types";
import { Paragraphs } from "../../blocks/section";
import { ForeignPayment } from "../../blocks/foreign-payment";
import { PaymentQr } from "../../blocks/gifts";
import { BLOCK_NAV, BLOCK_TITLE, type SiteCtx } from "../../context";
import { GalleryLightbox, type LightboxLabels } from "../../gallery-lightbox";
import {
  faqItems,
  galleryModel,
  giftsModel,
  heroModel,
  programDays,
  rsvpModel,
  storyImage,
  venueEntries,
  type ContentBlock,
} from "../../models";
import { Picture } from "../../picture";
import { PinGate, UnlockedRegion } from "../../pin-gate";
import { pinGateLabels } from "../../pin-labels";
import { rsvpLabels } from "../../rsvp/labels";
import { RsvpPrivacyNotice } from "../../rsvp/privacy-notice";
import { RsvpForm } from "../../rsvp/rsvp-form";
import { VenueMap } from "../../venue-map";
import { fitNames } from "./layout";
import { Label, SectionHead, SectionShell, Sprig, Wreath } from "./parts";

/**
 * Bloky šablony Eukalyptus nad sdílenými modely (`../../models`): každý blok má vlastní kompozici a plochu,
 * data a pravidla (PIN, soukromá místa, fáze) jsou stejná jako u ostatních šablon. Formuláře RSVP a PINu,
 * QR platba, galerie a mapa jsou sdílené komponenty; barvy dostávají přes proměnné `--s-*` plochy.
 */

export interface EuBlockProps<T extends ContentBlock["type"]> {
  block: BlockOf<T>;
  ctx: SiteCtx;
  tone: SurfaceKey;
  /** Římské číslo sekce podle vykreslených bloků. */
  index: string;
}

const headingId = (anchor: string) => `${anchor}-nadpis`;

/* ------------------------------------------------------------------ úvod */

export function EuHero({
  block,
  ctx,
  links,
}: {
  block: BlockOf<"hero">;
  ctx: SiteCtx;
  /** Odkazy na sekce v liště dole (stejné jako navigace). */
  links: { anchor: string; label: string }[];
}) {
  const { content, t, locale } = ctx;
  const { thanks, venue } = heroModel(block, ctx);
  const photo = ctx.media(block.data.photoMediaId);
  const fit = fitNames(content.partners.a, content.partners.b);
  const style = {
    "--eu-chars-inline": fit.inlineChars,
    "--eu-chars-stacked": fit.stackedChars,
  } as CSSProperties;

  return (
    <section
      id={block.anchor}
      aria-labelledby="site-jmena"
      className={photo ? "eu-hero" : "eu-hero eu-paper"}
      data-tone="light"
      data-photo={photo ? "true" : undefined}
    >
      {photo ? (
        <div className="eu-hero-photo">
          <Picture
            media={photo}
            alt={ctx.text(photo.alt)}
            lang={ctx.lang(photo.alt)}
            sizes="100vw"
            loading="eager"
          />
        </div>
      ) : (
        <Sprig className="eu-hero-sprig eu-hero-sprig-a" />
      )}
      <Sprig className="eu-hero-sprig eu-hero-sprig-b" variant={2} />

      <div className="eu-hero-inner">
        <Label className="eu-hero-eyebrow">
          {thanks ? t("site.thanks.title") : t("site.hero.saveTheDate")}
        </Label>
        <h1 id="site-jmena" className="eu-names" data-layout={fit.layout} style={style}>
          <span className="eu-name">{content.partners.a}</span>{" "}
          <span className="eu-name eu-name-b">
            {/* „&“ a druhé jméno se nerozdělí (nezlomitelná mezera) */}
            <span className="eu-amp">&amp;</span>
            {"\u00a0"}
            {content.partners.b}
          </span>
        </h1>
        <div className="eu-hero-meta">
          <p className="eu-hero-date">
            <time dateTime={content.startsOn}>
              {formatDateRange(content.startsOn, content.endsOn, locale)}
            </time>
          </p>
          {venue ? (
            <>
              <span className="eu-rule" aria-hidden="true" />
              <p className="eu-hero-place" lang={ctx.lang(venue.name)}>
                {ctx.text(venue.name)}
              </p>
            </>
          ) : null}
        </div>
        {thanks ? (
          ctx.text(content.thanksMessage) ? (
            <Paragraphs value={content.thanksMessage} ctx={ctx} className="eu-lead" />
          ) : (
            <p className="eu-lead">{t("site.thanks.body")}</p>
          )
        ) : (
          <Paragraphs value={block.data.tagline} ctx={ctx} className="eu-lead" />
        )}
      </div>

      {links.length > 0 ? (
        <div className="eu-hero-bar">
          <ul>
            {links.map((link) => (
              <li key={link.anchor}>
                <a href={`#${link.anchor}`} className="eu-hero-bar-link">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <a href={`#${links[0].anchor}`} className="eu-hero-next" aria-label={t("site.hero.next")}>
            <Icon icon={ArrowDown} />
          </a>
        </div>
      ) : null}
    </section>
  );
}

/* --------------------------------------------------------------- odpočet */

/** Odpočet: statický text spočítaný na serveru v časovém pásmu svatby (žádné `aria-live`). */
export function EuCountdown({ ctx, days, tone }: { ctx: SiteCtx; days: number; tone: SurfaceKey }) {
  const { t, content, locale } = ctx;
  return (
    <SectionShell id="odpocet" tone={tone} labelledBy="odpocet-nadpis" part="countdown">
      <div className="eu-wrap eu-countdown">
        {days === 0 ? (
          <h2 id="odpocet-nadpis" className="eu-count-today">
            {t("site.hero.today")}
          </h2>
        ) : (
          <>
            <h2 id="odpocet-nadpis" className="eu-label">
              {t("site.countdown.label", { count: days })}
            </h2>
            <p className="eu-count">
              <span className="eu-count-num">{days}</span>{" "}
              <span className="eu-count-unit">{t("site.countdown.unit", { count: days })}</span>
            </p>
          </>
        )}
        <p className="eu-count-date">
          <time dateTime={content.startsOn}>
            {formatDateRange(content.startsOn, content.endsOn, locale)}
          </time>
        </p>
      </div>
    </SectionShell>
  );
}

/* --------------------------------------------------------------- program */

export function EuProgram({ block, ctx, tone, index }: EuBlockProps<"program">) {
  const { t } = ctx;
  const { days, multiDay } = programDays(ctx);
  const id = headingId(block.anchor);
  return (
    <SectionShell id={block.anchor} tone={tone} labelledBy={id} part="program">
      <Sprig className="eu-section-sprig" variant={2} />
      <div className="eu-wrap eu-split">
        <div className="eu-split-aside">
          <SectionHead
            id={id}
            index={index}
            meta={multiDay ? undefined : days[0]?.label}
            title={t(BLOCK_TITLE.program)}
            className="eu-sticky-head"
          />
          <Paragraphs value={block.data.intro} ctx={ctx} className="eu-lead" />
        </div>
        <div>
          {days.map(({ day, label, entries }) => (
            <div key={day} className="eu-program-day">
              {multiDay ? <h3 className="eu-h3 eu-program-daylabel">{label}</h3> : null}
              <ol className="eu-program">
                {entries.map(({ event, venue, start, end }) => (
                  <li key={event.id} className="eu-program-item">
                    <p className="eu-program-time">
                      <time dateTime={event.startsAt}>{start}</time>
                      {end ? (
                        <span className="eu-program-end">
                          {" – "}
                          <time dateTime={event.endsAt ?? undefined}>{end}</time>
                        </span>
                      ) : null}
                    </p>
                    <div className="eu-program-body">
                      <h3 className="eu-program-title" lang={ctx.lang(event.title)}>
                        {ctx.text(event.title)}
                      </h3>
                      {venue ? (
                        <p className="eu-program-place" lang={ctx.lang(venue.name)}>
                          {ctx.text(venue.name)}
                        </p>
                      ) : null}
                      <Paragraphs value={event.description} ctx={ctx} className="eu-muted" />
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

/* --------------------------------------------------------- místo konání */

export function EuVenues({ block, ctx, tone, index }: EuBlockProps<"venue">) {
  const { t } = ctx;
  const { entries, points } = venueEntries(block, ctx);
  const id = headingId(block.anchor);
  return (
    <SectionShell id={block.anchor} tone={tone} labelledBy={id} part="venue" className="eu-paper">
      <div className="eu-wrap eu-split eu-split-even">
        <div className="eu-split-aside">
          <SectionHead id={id} index={index} title={t(BLOCK_TITLE.venue)} />
          <Paragraphs value={block.data.intro} ctx={ctx} className="eu-lead" />
          <Sprig className="eu-venue-sprig" />
        </div>
        <ol className="eu-venues">
          {entries.map(({ venue, address, mapUrl, directions, locked, point }, i) => (
            <li key={venue.id} className="eu-venue">
              <p className="eu-venue-num" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </p>
              <article className="eu-venue-body" aria-labelledby={`venue-${venue.id}`}>
                <h3 id={`venue-${venue.id}`} className="eu-venue-name" lang={ctx.lang(venue.name)}>
                  {ctx.text(venue.name)}
                </h3>
                {locked ? (
                  <div className="eu-gate">
                    <Icon icon={Lock} size={24} />
                    <PinGate
                      labels={pinGateLabels(t, "venue")}
                      locale={ctx.locale}
                      unlockKey={`venue:${venue.id}`}
                      headingLevel={4}
                    />
                  </div>
                ) : address ? (
                  venue.isPrivate ? (
                    <UnlockedRegion label={t("site.pin.unlocked")} unlockKey={`venue:${venue.id}`}>
                      <address className="eu-address">{address}</address>
                    </UnlockedRegion>
                  ) : (
                    <address className="eu-address">{address}</address>
                  )
                ) : null}
                {directions ? (
                  <>
                    <p className="eu-label eu-label-sm">{t("site.venue.directions")}</p>
                    <Paragraphs value={directions} ctx={ctx} />
                  </>
                ) : null}
                {mapUrl || point ? (
                  <p className="eu-links">
                    {mapUrl ? (
                      <a
                        href={mapUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="eu-link"
                      >
                        {t("site.venue.map")}
                        <Icon icon={ExternalLink} size={16} />
                      </a>
                    ) : null}
                    {point ? (
                      <>
                        <a
                          href={mapyCzUrl(point.lat, point.lng)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="eu-link"
                        >
                          {t("site.venue.mapyCz")}
                          <Icon icon={ExternalLink} size={16} />
                        </a>
                        <a
                          href={googleMapsUrl(point.lat, point.lng)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="eu-link"
                        >
                          {t("site.venue.googleMaps")}
                          <Icon icon={ExternalLink} size={16} />
                        </a>
                      </>
                    ) : null}
                    <span className="eu-muted eu-hint">{t("site.venue.mapHint")}</span>
                  </p>
                ) : null}
              </article>
            </li>
          ))}
        </ol>
      </div>
      {points.length > 0 ? <VenueMap points={points} ctx={ctx} /> : null}
    </SectionShell>
  );
}

/* ------------------------------------------------------ potvrzení účasti */

export function EuRsvp({ block, ctx, tone, index }: EuBlockProps<"rsvp">) {
  const { t } = ctx;
  const { open, closes, status } = rsvpModel(ctx);
  const id = headingId(block.anchor);
  return (
    <SectionShell id={block.anchor} tone={tone} labelledBy={id} part="rsvp">
      {/* Vodoznak je jen kresba: text je v CSS (`::before`), ne v obsahu stránky. */}
      <span className="eu-watermark" aria-hidden="true" data-text={t("site.rsvp.watermark")} />
      <div className="eu-wrap eu-split eu-split-even">
        <div className="eu-split-aside">
          <SectionHead
            id={id}
            index={index}
            meta={open && closes ? t("rsvp.closesAt", { date: closes }) : undefined}
            title={t(BLOCK_TITLE.rsvp)}
          />
          <Paragraphs value={block.data.intro} ctx={ctx} className="eu-lead" />
        </div>
        <div className="eu-rsvp-form">
          {open ? (
            <>
              <RsvpForm
                labels={rsvpLabels(t)}
                locale={ctx.locale}
                initial={ctx.rsvp?.initial ?? { stage: "name" }}
                allowUnlisted={ctx.rsvp?.allowUnlisted ?? false}
                closes={null}
              />
              <RsvpPrivacyNotice t={t} locale={ctx.locale} />
            </>
          ) : (
            <p className="eu-status">{status}</p>
          )}
        </div>
      </div>
    </SectionShell>
  );
}

/* ------------------------------------------------------------------ dary */

export function EuGifts({ block, ctx, tone }: EuBlockProps<"gifts">) {
  const { t } = ctx;
  const gifts = giftsModel(ctx);
  const id = headingId(block.anchor);
  return (
    <SectionShell id={block.anchor} tone={tone} labelledBy={id} part="gifts">
      <div className="eu-wrap eu-gifts">
        <div className="eu-wreath-wrap">
          <Wreath />
          <h2 id={id} className="eu-h2 eu-wreath-title">
            {t(BLOCK_TITLE.gifts)}
          </h2>
        </div>
        <div className="eu-gifts-body">
          {gifts ? (
            <UnlockedRegion label={t("site.pin.unlocked")} unlockKey="gifts">
              <Paragraphs value={block.data.intro} ctx={ctx} className="eu-lead" />
              <dl className="eu-facts">
                <div>
                  <dt>{t("site.gifts.account")}</dt>
                  <dd className="eu-account">{gifts.account}</dd>
                </div>
                {gifts.holder ? (
                  <div>
                    <dt>{t("site.gifts.holder")}</dt>
                    <dd>{gifts.holder}</dd>
                  </div>
                ) : null}
              </dl>
              <ForeignPayment gifts={gifts} ctx={ctx} facts="eu-facts" />
              <figure className="eu-qr">
                <PaymentQr
                  payload={buildSpayd({ iban: gifts.iban, message: gifts.paymentMessage })}
                  label={t("site.gifts.qrLabel", { account: gifts.account })}
                />
                <figcaption className="eu-muted">{t("site.gifts.qrHint")}</figcaption>
              </figure>
            </UnlockedRegion>
          ) : ctx.sensitiveUnlocked && ctx.sensitive !== null ? (
            // Host je po PINu, ale údaje o daru nejsou k dispozici: žádný nový formulář PINu (smyčka)
            <p className="eu-lead">{t("site.gifts.unavailable")}</p>
          ) : (
            <div className="eu-gate eu-gate-gifts">
              <PinGate labels={pinGateLabels(t, "gifts")} locale={ctx.locale} unlockKey="gifts" />
            </div>
          )}
        </div>
      </div>
    </SectionShell>
  );
}

/* ------------------------------------------------------------ fotografie */

export function EuPhotos({ block, ctx, tone, index }: EuBlockProps<"gallery">) {
  const { t } = ctx;
  const g = galleryModel(block, ctx);
  const id = headingId(block.anchor);
  const lightboxLabels: LightboxLabels = {
    open: t("site.gallery.open", { alt: "{alt}" }),
    openN: t("site.gallery.openN", { n: "{n}", total: "{total}" }),
    dialog: t("site.gallery.lightbox"),
    close: t("site.gallery.close"),
    prev: t("site.gallery.prev"),
    next: t("site.gallery.next"),
    counter: t("site.gallery.counter", { n: "{n}", total: "{total}" }),
  };
  // Varianta A: mozaika z fotografií páru; varianta B: typografický odkaz na externí galerii (nikdy cizí fotky).
  const mosaic =
    g.items.length > 0 ? (
      <div className="eu-mosaic" data-count={Math.min(g.items.length, 6)}>
        <GalleryLightbox items={g.items} labels={lightboxLabels} />
      </div>
    ) : null;
  const link = g.url ? (
    <a href={g.url} target="_blank" rel="noopener noreferrer" className="eu-linkblock">
      <Sprig className="eu-linkblock-sprig" variant={2} />
      <span className="eu-linkblock-title" lang={g.titleLang}>
        {g.title}
      </span>
      {g.description ? <span className="eu-linkblock-desc">{g.description}</span> : null}
      <span className="eu-linkblock-host">{g.host}</span>
      <span className="eu-linkblock-meta">
        <span>({t("site.gallery.external")})</span>
        <span className="eu-linkblock-arrow" aria-hidden="true">
          <Icon icon={ArrowUpRight} size={22} />
        </span>
      </span>
    </a>
  ) : null;

  return (
    <SectionShell id={block.anchor} tone={tone} labelledBy={id} part="gallery" className="eu-paper">
      <div className="eu-wrap">
        <SectionHead
          id={id}
          index={index}
          meta={g.url ? <span lang={g.titleLang}>{g.title}</span> : undefined}
          title={t(BLOCK_TITLE.gallery)}
        />
        {g.photosProtected ? null : mosaic}
        {g.linkProtected ? null : link}
        {g.gated ? (
          g.locked ? (
            <div className="eu-gate">
              <Icon icon={Lock} size={28} />
              <PinGate
                labels={pinGateLabels(t, "gallery")}
                locale={ctx.locale}
                unlockKey="gallery"
              />
            </div>
          ) : (
            <UnlockedRegion label={t("site.pin.unlocked")} unlockKey="gallery">
              {g.photosProtected ? mosaic : null}
              {g.linkProtected ? link : null}
            </UnlockedRegion>
          )
        ) : null}
      </div>
    </SectionShell>
  );
}

/* ------------------------------------------------------- volitelné bloky */

export function EuLodging({ block, ctx, tone, index }: EuBlockProps<"lodging">) {
  const { t } = ctx;
  const id = headingId(block.anchor);
  const transport = ctx.text(block.data.transport) !== "";
  return (
    <SectionShell id={block.anchor} tone={tone} labelledBy={id} part="lodging">
      <div className="eu-wrap">
        <SectionHead id={id} index={index} title={t(BLOCK_TITLE.lodging)} />
        <div className="eu-columns">
          {block.data.items.length > 0 ? (
            <div>
              <h3 className="eu-label">{t("site.lodging.stay")}</h3>
              <ul className="eu-rows">
                {block.data.items.map((item) => (
                  <li key={item.id}>
                    <p className="eu-row-title" lang={ctx.lang(item.name)}>
                      {item.url ? (
                        <a href={item.url} rel="noopener noreferrer" className="eu-link">
                          {ctx.text(item.name)}
                          <Icon icon={ExternalLink} size={16} />
                        </a>
                      ) : (
                        ctx.text(item.name)
                      )}
                    </p>
                    {item.address ? (
                      <address className="eu-address eu-muted">{item.address}</address>
                    ) : null}
                    <Paragraphs value={item.description} ctx={ctx} className="eu-muted" />
                    {item.lat !== null && item.lng !== null ? (
                      <p className="eu-links">
                        <a
                          href={mapyCzUrl(item.lat, item.lng)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="eu-link"
                        >
                          {t("site.venue.mapyCz")}
                          <Icon icon={ExternalLink} size={16} />
                        </a>
                        <a
                          href={googleMapsUrl(item.lat, item.lng)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="eu-link"
                        >
                          {t("site.venue.googleMaps")}
                          <Icon icon={ExternalLink} size={16} />
                        </a>
                        <span className="eu-muted eu-hint">{t("site.venue.mapHint")}</span>
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {transport ? (
            <div>
              <h3 className="eu-label">{t("site.lodging.transport")}</h3>
              <div className="eu-prose">
                <Paragraphs value={block.data.transport} ctx={ctx} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </SectionShell>
  );
}

export function EuDressCode({ block, ctx, tone, index }: EuBlockProps<"dresscode">) {
  const id = headingId(block.anchor);
  return (
    <SectionShell id={block.anchor} tone={tone} labelledBy={id} part="dresscode">
      <div className="eu-wrap eu-split">
        <SectionHead id={id} index={index} title={ctx.t(BLOCK_TITLE.dresscode)} />
        <div className="eu-quote">
          <Paragraphs value={block.data.text} ctx={ctx} />
        </div>
      </div>
    </SectionShell>
  );
}

export function EuFaq({ block, ctx, tone, index }: EuBlockProps<"faq">) {
  const id = headingId(block.anchor);
  return (
    <SectionShell id={block.anchor} tone={tone} labelledBy={id} part="faq" className="eu-paper">
      <div className="eu-wrap eu-split">
        <div className="eu-split-aside">
          <SectionHead
            id={id}
            index={index}
            title={ctx.t(BLOCK_TITLE.faq)}
            className="eu-sticky-head"
          />
        </div>
        <div className="eu-faq">
          {faqItems(block, ctx).map((item) => (
            <details key={item.id} className="eu-faq-item">
              <summary className="eu-faq-q" lang={ctx.lang(item.question)}>
                {ctx.text(item.question)}
              </summary>
              <div className="eu-faq-a">
                <Paragraphs value={item.answer} ctx={ctx} />
              </div>
            </details>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

export function EuContact({ block, ctx, tone, index }: EuBlockProps<"contact">) {
  const { t } = ctx;
  const id = headingId(block.anchor);
  return (
    <SectionShell id={block.anchor} tone={tone} labelledBy={id} part="contact">
      <div className="eu-wrap">
        <SectionHead id={id} index={index} title={t(BLOCK_TITLE.contact)} />
        <ul className="eu-people">
          {block.data.people.map((person) => (
            <li key={person.id} className="eu-person">
              <h3 className="eu-person-name">{person.name}</h3>
              {person.role ? (
                <p className="eu-label eu-label-sm" lang={ctx.lang(person.role)}>
                  {ctx.text(person.role)}
                </p>
              ) : null}
              {person.phone ? (
                <p>
                  <a href={`tel:${person.phone.replace(/\s/g, "")}`} className="eu-link">
                    <Icon icon={Phone} size={16} label={t("site.contact.phone")} />
                    {person.phone}
                  </a>
                </p>
              ) : null}
              {person.email ? (
                <p>
                  <a href={`mailto:${person.email}`} className="eu-link">
                    <Icon icon={Mail} size={16} label={t("site.contact.email")} />
                    {person.email}
                  </a>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </SectionShell>
  );
}

export function EuStory({ block, ctx, tone, index }: EuBlockProps<"story">) {
  const id = headingId(block.anchor);
  const image = storyImage(block, ctx);
  return (
    <SectionShell id={block.anchor} tone={tone} labelledBy={id} part="story" className="eu-paper">
      <div className="eu-wrap eu-split eu-split-even">
        <div>
          <SectionHead id={id} index={index} title={ctx.t(BLOCK_TITLE.story)} />
          <div className="eu-prose eu-story-text">
            <Paragraphs value={block.data.text} ctx={ctx} />
          </div>
        </div>
        {image ? (
          <figure className="eu-story-figure">
            <Picture
              media={image.media}
              alt={image.alt}
              lang={image.lang}
              sizes="(min-width: 768px) 45vw, 100vw"
            />
          </figure>
        ) : (
          <Sprig className="eu-story-sprig" />
        )}
      </div>
    </SectionShell>
  );
}

/* --------------------------------------------------------------- patička */

export function EuFooter({ ctx, tone }: { ctx: SiteCtx; tone: SurfaceKey }) {
  const { content, t, locale } = ctx;
  return (
    <footer className="eu-footer eu-section" data-tone={tone} data-part="footer">
      <div className="eu-wrap eu-footer-top">
        <p className="eu-footer-names">
          {t("site.footer.names", { a: content.partners.a, b: content.partners.b })}
        </p>
        <p className="eu-footer-date">
          <time dateTime={content.startsOn}>
            {formatDateRange(content.startsOn, content.endsOn, locale)}
          </time>
        </p>
      </div>
      {/* Obří jména jsou jen kresba (text v CSS `::before`); jména jsou výš jako text. */}
      <span
        className="eu-footer-giant"
        aria-hidden="true"
        data-text={`${content.partners.a} & ${content.partners.b}`}
      />
    </footer>
  );
}

/** Odkaz navigace pro blok (stejné popisky jako ostatní šablony). */
export function navLabel(block: ContentBlock, ctx: SiteCtx): string {
  return ctx.t(BLOCK_NAV[block.type]);
}
