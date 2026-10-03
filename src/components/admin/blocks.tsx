"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { Field } from "@/components/ui/field";
import { QrCode } from "@/components/wizard/qr-code";
import { useGeocode } from "@/components/wizard/use-geocode";
import type { Locale } from "@/i18n/config";
import { buildSpayd } from "@/site/payment";
import type { MediaActions } from "@/lib/media/action-types";
import { isReady, mediaSrc, type MediaItem } from "@/lib/media/types";
import type { GalleryCard } from "@/site/types";
import {
  newId,
  protectedPhotoIds,
  publishable,
  resolveAccount,
  type EditorBlock,
  type EditorBlockOf,
  type EditorDoc,
} from "@/admin/site/doc";
import { normalizeHttpsUrl, normalizePhone, normalizeUrl } from "@/admin/site/normalize";
import { EventsEditor, VenuesEditor } from "./events";
import { AddButton, ItemCard, LocalizedField, Note, SelectField } from "./fields";
import { useAdminT } from "./i18n";
import { PhotosPanel } from "./photos";

/** Výsledek načtení karty externí galerie (server, `refreshGalleryCardAction`). */
export type CardOutcome =
  | { status: "ok"; card: GalleryCard }
  | { status: "failed"; reason: string; card: GalleryCard }
  | { status: "invalid_url" }
  | { status: "limited" }
  | { status: "error" };

export interface EditorContext {
  doc: EditorDoc;
  locales: readonly Locale[];
  guestPinReady: boolean;
  update: (fn: (doc: EditorDoc) => EditorDoc) => void;
  refreshCard: (url: string) => Promise<CardOutcome>;
  /** Média svatby (fotografie a obrázky karet); drží je editor, aby je viděl i živý náhled. */
  media: readonly MediaItem[];
  setMedia: (fn: (items: MediaItem[]) => MediaItem[]) => void;
  mediaActions: MediaActions;
  /** Úložiště fotografií je nastavené (jinak se nahrávání nenabízí). */
  photosAvailable: boolean;
}

type Patch = Record<string, unknown>;

function patchBlock(ctx: EditorContext, id: string, patch: Patch) {
  ctx.update((doc) => ({
    ...doc,
    blocks: doc.blocks.map((block) =>
      block.id === id ? ({ ...block, data: { ...block.data, ...patch } } as EditorBlock) : block,
    ),
  }));
}

interface Props<T extends EditorBlock["type"]> {
  block: EditorBlockOf<T>;
  ctx: EditorContext;
}

/** Úvod: odpočet a podtitul. Jména a datum jsou v části Obecné. */
function HeroEditor({ block, ctx }: Props<"hero">) {
  const t = useAdminT();
  return (
    <>
      <Checkbox
        label={t("admin.block.hero.countdown")}
        checked={block.data.countdown}
        onChange={(event) => patchBlock(ctx, block.id, { countdown: event.target.checked })}
      />
      <LocalizedField
        label={t("admin.block.hero.tagline")}
        hint={t("admin.block.hero.taglineHint")}
        locales={ctx.locales}
        value={block.data.tagline}
        maxLength={200}
        onChange={(tagline) => patchBlock(ctx, block.id, { tagline })}
      />
      <HeroPhotoPicker block={block} ctx={ctx} />
    </>
  );
}

/**
 * Fotka přes celý úvod: výběr z hotových fotografií svatby s popiskem (nahrávají se v bloku Fotografie).
 * Doporučený formát je v nápovědě; na mobilu se fotka ořízne na výšku, proto hlavní motiv doprostřed.
 */
function HeroPhotoPicker({ block, ctx }: Props<"hero">) {
  const t = useAdminT();
  // Bez fotografií z galerie chráněné PINem: fotka úvodu je veřejná.
  const hidden = protectedPhotoIds(ctx.doc.blocks);
  const photos = ctx.media.filter(
    (m) => m.kind === "photo" && isReady(m) && publishable(m) && !hidden.has(m.id),
  );
  const chosen = photos.find((m) => m.id === block.data.photoMediaId);
  const label = (m: MediaItem, index: number) =>
    (m.alt && (m.alt[ctx.locales[0]] || Object.values(m.alt).find(Boolean))) ||
    t("admin.block.hero.photoUntitled", { n: index + 1 });
  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label={t("admin.block.hero.photo")}
        hint={t("admin.block.hero.photoHint")}
        value={chosen?.id ?? ""}
        onChange={(value) => patchBlock(ctx, block.id, { photoMediaId: value || null })}
      >
        <option value="">{t("admin.block.hero.photoNone")}</option>
        {photos.map((m, index) => (
          <option key={m.id} value={m.id}>
            {label(m, index)}
          </option>
        ))}
      </SelectField>
      {photos.length === 0 ? <Note tone="info">{t("admin.block.hero.photoEmpty")}</Note> : null}
      {chosen && chosen.widths.length > 0 ? (
        // eslint-disable-next-line @next/next/no-img-element -- náhled přes vlastní adresu, popisek je ve výběru
        <img
          src={mediaSrc(chosen.id, chosen.widths[0], "webp")}
          alt=""
          width={chosen.width ?? undefined}
          height={chosen.height ?? undefined}
          className="h-auto w-full max-w-64 rounded-xl"
        />
      ) : null}
    </div>
  );
}

function IntroEditor({
  block,
  ctx,
  label,
  hint,
}: {
  block: EditorBlockOf<"program" | "venue" | "rsvp" | "gifts">;
  ctx: EditorContext;
  label: string;
  hint?: string;
}) {
  return (
    <LocalizedField
      label={label}
      hint={hint}
      multiline
      locales={ctx.locales}
      value={block.data.intro}
      onChange={(intro) => patchBlock(ctx, block.id, { intro })}
    />
  );
}

function ProgramEditor({ block, ctx }: Props<"program">) {
  const t = useAdminT();
  return (
    <>
      <IntroEditor block={block} ctx={ctx} label={t("admin.block.intro")} />
      <EventsEditor ctx={ctx} />
    </>
  );
}

function VenueBlockEditor({ block, ctx }: Props<"venue">) {
  const t = useAdminT();
  const shown = new Set(block.data.venueIds);
  return (
    <>
      <IntroEditor block={block} ctx={ctx} label={t("admin.block.intro")} />
      <div className="flex flex-col gap-1">
        <Checkbox
          label={t("admin.venue.showMap")}
          checked={block.data.showMap}
          onChange={(event) => patchBlock(ctx, block.id, { showMap: event.target.checked })}
        />
        <p className="text-muted ps-9 text-sm">{t("admin.venue.showMapHint")}</p>
      </div>
      <VenuesEditor ctx={ctx} mapVenueIds={block.data.showMap ? block.data.venueIds : []} />
      {ctx.doc.venues.length > 0 ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-ink mb-1 font-medium">{t("admin.venue.shown")}</legend>
          <p className="text-muted text-sm">{t("admin.venue.shownHint")}</p>
          {ctx.doc.venues.map((venue, index) => (
            <Checkbox
              key={venue.id}
              label={
                venue.name.cs || venue.name.en || t("admin.venue.unnamed", { number: index + 1 })
              }
              checked={shown.has(venue.id)}
              onChange={(event) =>
                patchBlock(ctx, block.id, {
                  venueIds: event.target.checked
                    ? [...block.data.venueIds, venue.id]
                    : block.data.venueIds.filter((id) => id !== venue.id),
                })
              }
            />
          ))}
        </fieldset>
      ) : null}
    </>
  );
}

type LodgingItem = EditorBlockOf<"lodging">["data"]["items"][number];

/**
 * Souřadnice ubytování pro mapu místa konání: hledají se jen se zapnutou volbou mapy a po změně adresy znovu
 * (na serveru, Nominatim), stejně jako u míst konání. Stav hledání je hláška pod adresou.
 */
function LodgingGeo({
  item,
  onFound,
}: {
  item: LodgingItem;
  onFound: (lat: number, lng: number, address: string) => void;
}) {
  const t = useAdminT();
  const address = (item.address ?? "").trim();
  const located = item.lat !== null && item.lng !== null;
  const status = useGeocode(address !== "" && !located ? address : null, (hit) =>
    onFound(hit.lat, hit.lng, address),
  );
  if (address === "") return <Note tone="info">{t("admin.lodging.mapNeedsAddress")}</Note>;
  return (
    <p role="status" className="text-muted text-sm">
      {located ? t("admin.venue.geo.found") : t(`admin.venue.geo.${status ?? "searching"}`)}
    </p>
  );
}

function LodgingEditor({ block, ctx }: Props<"lodging">) {
  const t = useAdminT();
  const items = block.data.items;
  const setItems = (next: typeof items) => patchBlock(ctx, block.id, { items: next });
  const patchItem = (id: string, change: Partial<LodgingItem>) =>
    setItems(items.map((x) => (x.id === id ? { ...x, ...change } : x)));
  return (
    <>
      <div className="flex flex-col gap-4">
        {items.map((item, index) => {
          const urlBad = Boolean(item.url) && normalizeUrl(item.url ?? "") === null;
          return (
            <ItemCard
              key={item.id}
              title={t("admin.lodging.itemTitle", { number: index + 1 })}
              removeLabel={t("admin.lodging.remove", { number: index + 1 })}
              onRemove={() => setItems(items.filter((x) => x.id !== item.id))}
            >
              <LocalizedField
                label={t("admin.lodging.name")}
                locales={ctx.locales}
                value={item.name}
                maxLength={200}
                onChange={(name) =>
                  setItems(items.map((x) => (x.id === item.id ? { ...x, name: name ?? {} } : x)))
                }
              />
              <LocalizedField
                label={t("admin.lodging.description")}
                multiline
                locales={ctx.locales}
                value={item.description}
                onChange={(description) =>
                  setItems(items.map((x) => (x.id === item.id ? { ...x, description } : x)))
                }
              />
              <Field
                label={t("admin.lodging.url")}
                hint={t("admin.lodging.urlHint")}
                type="url"
                inputMode="url"
                autoComplete="off"
                value={item.url ?? ""}
                error={urlBad ? t("admin.error.url") : undefined}
                onChange={(event) =>
                  setItems(
                    items.map((x) =>
                      x.id === item.id ? { ...x, url: event.target.value || null } : x,
                    ),
                  )
                }
              />
              <Field
                label={t("admin.lodging.address")}
                hint={t("admin.lodging.addressHint")}
                autoComplete="off"
                maxLength={250}
                value={item.address ?? ""}
                // Souřadnice patří k adrese: po úpravě se zahodí a hledají znovu.
                onChange={(event) =>
                  patchItem(item.id, { address: event.target.value || null, lat: null, lng: null })
                }
              />
              <Checkbox
                label={t("admin.lodging.showOnMap")}
                checked={item.showOnMap}
                onChange={(event) => patchItem(item.id, { showOnMap: event.target.checked })}
              />
              {item.showOnMap ? (
                <LodgingGeo
                  item={item}
                  onFound={(lat, lng, address) =>
                    // Jen pokud se adresa mezitím nezměnila (výsledek pro starou adresu se zahodí)
                    ctx.update((d) => ({
                      ...d,
                      blocks: d.blocks.map((b) =>
                        b.id === block.id && b.type === "lodging"
                          ? {
                              ...b,
                              data: {
                                ...b.data,
                                items: b.data.items.map((x) =>
                                  x.id === item.id && (x.address ?? "").trim() === address
                                    ? { ...x, lat, lng }
                                    : x,
                                ),
                              },
                            }
                          : b,
                      ),
                    }))
                  }
                />
              ) : null}
            </ItemCard>
          );
        })}
        <div>
          <AddButton
            onClick={() =>
              setItems([
                ...items,
                {
                  id: newId(),
                  name: {},
                  description: null,
                  url: null,
                  address: null,
                  showOnMap: false,
                  lat: null,
                  lng: null,
                },
              ])
            }
          >
            {t("admin.lodging.add")}
          </AddButton>
        </div>
      </div>
      <LocalizedField
        label={t("admin.lodging.transport")}
        hint={t("admin.lodging.transportHint")}
        multiline
        locales={ctx.locales}
        value={block.data.transport}
        onChange={(transport) => patchBlock(ctx, block.id, { transport })}
      />
    </>
  );
}

function DresscodeEditor({ block, ctx }: Props<"dresscode">) {
  const t = useAdminT();
  return (
    <LocalizedField
      label={t("admin.dresscode.text")}
      multiline
      locales={ctx.locales}
      value={block.data.text}
      onChange={(text) => patchBlock(ctx, block.id, { text: text ?? {} })}
    />
  );
}

function FaqEditor({ block, ctx }: Props<"faq">) {
  const t = useAdminT();
  const items = block.data.items;
  const setItems = (next: typeof items) => patchBlock(ctx, block.id, { items: next });
  return (
    <div className="flex flex-col gap-4">
      {items.map((item, index) => (
        <ItemCard
          key={item.id}
          title={t("admin.faq.itemTitle", { number: index + 1 })}
          removeLabel={t("admin.faq.remove", { number: index + 1 })}
          onRemove={() => setItems(items.filter((x) => x.id !== item.id))}
        >
          <LocalizedField
            label={t("admin.faq.question")}
            locales={ctx.locales}
            value={item.question}
            maxLength={200}
            onChange={(question) =>
              setItems(
                items.map((x) => (x.id === item.id ? { ...x, question: question ?? {} } : x)),
              )
            }
          />
          <LocalizedField
            label={t("admin.faq.answer")}
            multiline
            locales={ctx.locales}
            value={item.answer}
            onChange={(answer) =>
              setItems(items.map((x) => (x.id === item.id ? { ...x, answer: answer ?? {} } : x)))
            }
          />
        </ItemCard>
      ))}
      <div>
        <AddButton onClick={() => setItems([...items, { id: newId(), question: {}, answer: {} }])}>
          {t("admin.faq.add")}
        </AddButton>
      </div>
    </div>
  );
}

function ContactEditor({ block, ctx }: Props<"contact">) {
  const t = useAdminT();
  const people = block.data.people;
  const setPeople = (next: typeof people) => patchBlock(ctx, block.id, { people: next });
  const patchPerson = (id: string, patch: Partial<(typeof people)[number]>) =>
    setPeople(people.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  return (
    <div className="flex flex-col gap-4">
      {people.map((person, index) => {
        const emailBad =
          Boolean(person.email) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((person.email ?? "").trim());
        const phoneBad = Boolean(person.phone) && normalizePhone(person.phone ?? "") === null;
        return (
          <ItemCard
            key={person.id}
            title={t("admin.contact.itemTitle", { number: index + 1 })}
            removeLabel={t("admin.contact.remove", { number: index + 1 })}
            onRemove={() => setPeople(people.filter((p) => p.id !== person.id))}
          >
            <Field
              label={t("admin.contact.name")}
              autoComplete="off"
              value={person.name}
              maxLength={100}
              onChange={(event) => patchPerson(person.id, { name: event.target.value })}
            />
            <LocalizedField
              label={t("admin.contact.role")}
              locales={ctx.locales}
              value={person.role}
              maxLength={200}
              onChange={(role) => patchPerson(person.id, { role })}
            />
            <Field
              label={t("admin.contact.email")}
              type="email"
              autoComplete="off"
              value={person.email ?? ""}
              error={emailBad ? t("admin.error.email") : undefined}
              onChange={(event) => patchPerson(person.id, { email: event.target.value || null })}
            />
            <Field
              label={t("admin.contact.phone")}
              hint={t("admin.contact.phoneHint")}
              type="tel"
              autoComplete="off"
              value={person.phone ?? ""}
              error={phoneBad ? t("admin.error.phone") : undefined}
              onChange={(event) => patchPerson(person.id, { phone: event.target.value || null })}
            />
          </ItemCard>
        );
      })}
      <div>
        <AddButton
          onClick={() =>
            setPeople([...people, { id: newId(), name: "", role: null, email: null, phone: null }])
          }
        >
          {t("admin.contact.add")}
        </AddButton>
      </div>
    </div>
  );
}

function StoryEditor({ block, ctx }: Props<"story">) {
  const t = useAdminT();
  return (
    <LocalizedField
      label={t("admin.story.text")}
      hint={t("admin.story.hint")}
      multiline
      rows={6}
      locales={ctx.locales}
      value={block.data.text}
      onChange={(text) => patchBlock(ctx, block.id, { text: text ?? {} })}
    />
  );
}

function GiftsEditor({ block, ctx }: Props<"gifts">) {
  const t = useAdminT();
  const resolved = resolveAccount(block.data.account);
  const bad = block.data.account.trim() !== "" && resolved === null;
  return (
    <>
      <Note tone="info">{t("admin.gifts.pinNote")}</Note>
      {!ctx.guestPinReady ? <Note>{t("admin.gifts.pinMissing")}</Note> : null}
      <IntroEditor block={block} ctx={ctx} label={t("admin.block.intro")} />
      <Field
        label={t("admin.gifts.account")}
        hint={t("admin.gifts.accountHint")}
        autoComplete="off"
        inputMode="text"
        value={block.data.account}
        maxLength={60}
        error={bad ? t("admin.error.account") : undefined}
        onChange={(event) => patchBlock(ctx, block.id, { account: event.target.value })}
      />
      <Field
        label={t("admin.gifts.holder")}
        autoComplete="off"
        value={block.data.holder ?? ""}
        maxLength={100}
        onChange={(event) => patchBlock(ctx, block.id, { holder: event.target.value || null })}
      />
      <Field
        label={t("admin.gifts.message")}
        hint={t("admin.gifts.messageHint")}
        autoComplete="off"
        value={block.data.paymentMessage ?? ""}
        maxLength={60}
        onChange={(event) =>
          patchBlock(ctx, block.id, { paymentMessage: event.target.value || null })
        }
      />
      {resolved ? (
        <figure className="flex flex-col gap-2">
          <QrCode
            payload={buildSpayd({ iban: resolved.iban, message: block.data.paymentMessage })}
            label={t("admin.gifts.qrLabel", { account: resolved.account })}
            className="size-40 rounded-xl border border-black/10"
          />
          <figcaption className="text-muted max-w-xs text-sm">
            {t("admin.gifts.qrCaption", { iban: resolved.iban })}
          </figcaption>
        </figure>
      ) : null}
    </>
  );
}

function GalleryEditor({ block, ctx }: Props<"gallery">) {
  const t = useAdminT();
  const link = block.data.link;
  const [status, setStatus] = useState<
    "idle" | "loading" | "ok" | "failed" | "invalid_url" | "limited" | "error"
  >("idle");
  const [fetchedFor, setFetchedFor] = useState<string | null>(
    link?.card ? (normalizeHttpsUrl(link.url) ?? null) : null,
  );
  const normalized = link ? normalizeHttpsUrl(link.url) : null;
  const urlBad = Boolean(link?.url.trim()) && normalized === null;

  const setLink = (patch: Partial<NonNullable<typeof link>>) =>
    patchBlock(ctx, block.id, { link: link ? { ...link, ...patch } : null });

  async function refresh() {
    if (!link) return;
    const url = normalizeHttpsUrl(link.url);
    if (!url) {
      setStatus("invalid_url");
      return;
    }
    setStatus("loading");
    const outcome = await ctx.refreshCard(url);
    if (outcome.status === "ok" || outcome.status === "failed") {
      patchBlock(ctx, block.id, { link: { ...link, card: outcome.card } });
      setFetchedFor(url);
    }
    setStatus(outcome.status);
  }

  const card = link?.card ?? null;
  const patchIds = (change: (ids: string[]) => string[]) =>
    ctx.update((doc) => ({
      ...doc,
      blocks: doc.blocks.map((b) =>
        b.id === block.id && b.type === "gallery"
          ? { ...b, data: { ...b.data, mediaIds: change(b.data.mediaIds) } }
          : b,
      ),
    }));

  return (
    <>
      <PhotosPanel
        ids={block.data.mediaIds}
        media={ctx.media}
        setMedia={ctx.setMedia}
        actions={ctx.mediaActions}
        available={ctx.photosAvailable}
        locales={ctx.locales}
        onReorder={(ids) => patchIds(() => ids)}
        onAdd={(id) => patchIds((ids) => (ids.includes(id) ? ids : [...ids, id]))}
        onRemove={(id) => patchIds((ids) => ids.filter((x) => x !== id))}
        photosProtected={block.data.photosProtected}
        onProtectedChange={(value) => patchBlock(ctx, block.id, { photosProtected: value })}
        guestPinReady={ctx.guestPinReady}
      />
      <h4 className="text-ink font-sans text-base font-semibold">{t("admin.gallery.linkTitle")}</h4>
      <Checkbox
        label={t("admin.gallery.enableLink")}
        checked={link !== null}
        onChange={(event) =>
          patchBlock(ctx, block.id, {
            link: event.target.checked
              ? { url: "", label: null, protected: false, card: null }
              : null,
          })
        }
      />
      {link ? (
        <div className="flex flex-col gap-4">
          <Field
            label={t("admin.gallery.url")}
            hint={t("admin.gallery.urlHint")}
            type="url"
            inputMode="url"
            autoComplete="off"
            maxLength={500}
            value={link.url}
            error={urlBad ? t("admin.error.https") : undefined}
            onChange={(event) => setLink({ url: event.target.value })}
            onBlur={() => {
              // Karta se načte při změně odkazu, ne při každém úhozu ani při zobrazení webu hostem.
              if (normalized && normalized !== fetchedFor && status !== "loading") void refresh();
            }}
          />
          <LocalizedField
            label={t("admin.gallery.label")}
            hint={t("admin.gallery.labelHint")}
            locales={ctx.locales}
            value={link.label}
            maxLength={200}
            onChange={(label) => setLink({ label })}
          />
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => void refresh()}
                disabled={status === "loading" || normalized === null}
              >
                {status === "loading" ? t("admin.gallery.refreshing") : t("admin.gallery.refresh")}
              </Button>
            </div>
            <div role="status" aria-live="polite" className="flex flex-col gap-1">
              {status === "ok" ? <Note tone="info">{t("admin.gallery.status.ok")}</Note> : null}
              {status === "failed" ? <Note>{t("admin.gallery.status.failed")}</Note> : null}
              {status === "invalid_url" ? <Note>{t("admin.error.https")}</Note> : null}
              {status === "limited" ? <Note>{t("admin.gallery.status.limited")}</Note> : null}
              {status === "error" ? <Note>{t("admin.gallery.status.error")}</Note> : null}
            </div>
            {card?.status === "ok" && (card.title || card.description) ? (
              <div className="border-hairline bg-parchment rounded-xl border p-3">
                <p className="text-muted text-sm">{t("admin.gallery.cardFound")}</p>
                {card.title ? <p className="text-ink font-medium">{card.title}</p> : null}
                {card.description ? <p className="text-muted text-sm">{card.description}</p> : null}
              </div>
            ) : card?.status === "failed" || (link.url && !card) ? (
              <Note tone="info">{t("admin.gallery.cardFallback")}</Note>
            ) : null}
          </div>
          <Checkbox
            label={t("admin.gallery.protected")}
            checked={link.protected}
            onChange={(event) => setLink({ protected: event.target.checked })}
          />
          <Note tone="info">{t("admin.gallery.protectedHint")}</Note>
          {link.protected && !ctx.guestPinReady ? <Note>{t("admin.gifts.pinMissing")}</Note> : null}
        </div>
      ) : null}
    </>
  );
}

function RsvpEditor({ block, ctx }: Props<"rsvp">) {
  const t = useAdminT();
  return (
    <>
      <IntroEditor block={block} ctx={ctx} label={t("admin.block.intro")} />
      <Note tone="info">{t("admin.rsvp.settingsNote")}</Note>
    </>
  );
}

/** Formulář bloku podle druhu (jeden blok = jeden druh, FR-ADM-1). */
export function BlockForm({ block, ctx }: { block: EditorBlock; ctx: EditorContext }) {
  switch (block.type) {
    case "hero":
      return <HeroEditor block={block} ctx={ctx} />;
    case "program":
      return <ProgramEditor block={block} ctx={ctx} />;
    case "venue":
      return <VenueBlockEditor block={block} ctx={ctx} />;
    case "lodging":
      return <LodgingEditor block={block} ctx={ctx} />;
    case "dresscode":
      return <DresscodeEditor block={block} ctx={ctx} />;
    case "faq":
      return <FaqEditor block={block} ctx={ctx} />;
    case "contact":
      return <ContactEditor block={block} ctx={ctx} />;
    case "story":
      return <StoryEditor block={block} ctx={ctx} />;
    case "gifts":
      return <GiftsEditor block={block} ctx={ctx} />;
    case "gallery":
      return <GalleryEditor block={block} ctx={ctx} />;
    case "rsvp":
      return <RsvpEditor block={block} ctx={ctx} />;
  }
}
