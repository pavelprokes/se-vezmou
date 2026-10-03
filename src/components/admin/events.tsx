"use client";

import { Checkbox } from "@/components/ui/choice";
import { Field } from "@/components/ui/field";
import { newId, type EditorEvent, type EditorVenue } from "@/admin/site/doc";
import { normalizeUrl } from "@/admin/site/normalize";
import { isoParts, joinParts } from "@/admin/site/time";
import { todayIn, zonedIso } from "@/wizard/zoned";
import { useGeocode } from "@/components/wizard/use-geocode";
import type { EditorContext } from "./blocks";
import { AddButton, ItemCard, LocalizedField, Note, SelectField } from "./fields";
import { useAdminT } from "./i18n";

/** Program po hodinách: události s časem, místem a pozváním hostů. Seřazené podle začátku. */
export function EventsEditor({ ctx }: { ctx: EditorContext }) {
  const t = useAdminT();
  const { doc } = ctx;
  const zone = doc.wedding.timezone;
  // Podle okamžiku, ne podle řetězce: ISO časy mají různé posuny (`+02:00` z formuláře, `+00:00` z databáze).
  const events = [...doc.events].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  const setEvents = (next: EditorEvent[]) => ctx.update((d) => ({ ...d, events: next }));
  const patch = (id: string, change: Partial<EditorEvent>) =>
    setEvents(doc.events.map((event) => (event.id === id ? { ...event, ...change } : event)));

  function addEvent() {
    const date = doc.wedding.startsOn || todayIn(new Date(), zone);
    setEvents([
      ...doc.events,
      {
        id: newId(),
        kind: "other",
        title: {},
        description: null,
        startsAt: zonedIso(date, "12:00", zone),
        endsAt: null,
        venueId: null,
        rsvpEnabled: false,
      },
    ]);
  }

  return (
    <section aria-labelledby="events-heading" className="flex flex-col gap-4">
      <h4 id="events-heading" className="text-ink font-sans text-lg font-semibold">
        {t("admin.events.title")}
      </h4>
      <p className="text-muted text-sm">{t("admin.events.hint")}</p>
      {events.length === 0 ? <p className="text-muted">{t("admin.events.empty")}</p> : null}
      {events.map((event, index) => {
        const start = isoParts(event.startsAt, zone);
        const end = event.endsAt ? isoParts(event.endsAt, zone) : { date: "", time: "" };
        const endBefore =
          Boolean(event.endsAt) && Date.parse(event.endsAt ?? "") < Date.parse(event.startsAt);
        return (
          <ItemCard
            key={event.id}
            id={`event-${event.id}`}
            title={t("admin.events.itemTitle", { number: index + 1 })}
            removeLabel={t("admin.events.remove", { number: index + 1 })}
            onRemove={() => setEvents(doc.events.filter((x) => x.id !== event.id))}
          >
            <SelectField
              label={t("admin.events.kind")}
              value={event.kind}
              onChange={(value) => {
                const kind = value as EditorEvent["kind"];
                patch(event.id, { kind, rsvpEnabled: kind !== "other" ? true : event.rsvpEnabled });
              }}
            >
              <option value="ceremony">{t("admin.events.kind.ceremony")}</option>
              <option value="reception">{t("admin.events.kind.reception")}</option>
              <option value="other">{t("admin.events.kind.other")}</option>
            </SelectField>
            <LocalizedField
              label={t("admin.events.name")}
              required
              locales={ctx.locales}
              value={event.title}
              maxLength={200}
              onChange={(title) => patch(event.id, { title: title ?? {} })}
            />
            <LocalizedField
              label={t("admin.events.description")}
              multiline
              locales={ctx.locales}
              value={event.description}
              onChange={(description) => patch(event.id, { description })}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label={t("admin.events.date")}
                type="date"
                autoComplete="off"
                value={start.date}
                onChange={(e) => {
                  const next = joinParts(e.target.value, start.time || "12:00", zone);
                  if (next) patch(event.id, { startsAt: next });
                }}
              />
              <Field
                label={t("admin.events.start")}
                type="time"
                autoComplete="off"
                value={start.time}
                onChange={(e) => {
                  const next = joinParts(start.date, e.target.value, zone);
                  if (next) patch(event.id, { startsAt: next });
                }}
              />
              <Field
                label={t("admin.events.end")}
                type="time"
                autoComplete="off"
                value={end.time}
                error={endBefore ? t("admin.events.endBefore") : undefined}
                onChange={(e) => {
                  if (e.target.value === "") return patch(event.id, { endsAt: null });
                  const next = joinParts(start.date, e.target.value, zone);
                  if (next) patch(event.id, { endsAt: next });
                }}
              />
            </div>
            <SelectField
              label={t("admin.events.venue")}
              value={event.venueId ?? ""}
              onChange={(value) => patch(event.id, { venueId: value || null })}
            >
              <option value="">{t("admin.events.venueNone")}</option>
              {doc.venues.map((venue, i) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name.cs || venue.name.en || t("admin.venue.unnamed", { number: i + 1 })}
                </option>
              ))}
            </SelectField>
            <Checkbox
              label={t("admin.events.rsvp")}
              checked={event.rsvpEnabled}
              onChange={(e) => patch(event.id, { rsvpEnabled: e.target.checked })}
            />
            <Note tone="info">{t("admin.events.removeNote")}</Note>
          </ItemCard>
        );
      })}
      <div>
        <AddButton onClick={addEvent} disabled={doc.events.length >= 60}>
          {t("admin.events.add")}
        </AddButton>
      </div>
    </section>
  );
}

/**
 * Souřadnice místa pro mapu (blok Místo s `showMap`): po změně adresy se hledají znovu (na serveru,
 * Nominatim). Stav hledání je hláška pod adresou; soukromé místo na mapě není, nehledá se.
 */
function VenueGeo({ venue, ctx }: { venue: EditorVenue; ctx: EditorContext }) {
  const t = useAdminT();
  const address = venue.address.trim();
  const located = venue.lat !== null && venue.lng !== null;
  const status = useGeocode(address !== "" && !located ? address : null, (hit) =>
    ctx.update((d) => ({
      ...d,
      venues: d.venues.map((v) =>
        v.id === venue.id && v.address.trim() === address
          ? { ...v, lat: hit.lat, lng: hit.lng }
          : v,
      ),
    })),
  );
  if (address === "") return null;
  return (
    <p role="status" className="text-muted text-sm">
      {located ? t("admin.venue.geo.found") : t(`admin.venue.geo.${status ?? "searching"}`)}
    </p>
  );
}

/** Místa konání: textová adresa je vždy, mapa je doplněk (FR-WEB-1); soukromé místo je za PINem. */
export function VenuesEditor({
  ctx,
  mapVenueIds = [],
}: {
  ctx: EditorContext;
  /** Místa na mapě (blok Místo se zapnutou mapou); jen jejich souřadnice se hledají. */
  mapVenueIds?: readonly string[];
}) {
  const t = useAdminT();
  const { doc } = ctx;
  const setVenues = (next: EditorVenue[]) =>
    ctx.update((d) => {
      const ids = new Set(next.map((v) => v.id));
      return {
        ...d,
        venues: next,
        // Odebrané místo se odpojí od událostí i od zobrazení v bloku Místo.
        events: d.events.map((e) =>
          e.venueId && !ids.has(e.venueId) ? { ...e, venueId: null } : e,
        ),
        blocks: d.blocks.map((b) =>
          b.type === "venue"
            ? { ...b, data: { ...b.data, venueIds: b.data.venueIds.filter((id) => ids.has(id)) } }
            : b,
        ),
      };
    });
  const patch = (id: string, change: Partial<EditorVenue>) =>
    setVenues(doc.venues.map((venue) => (venue.id === id ? { ...venue, ...change } : venue)));

  return (
    <section aria-labelledby="venues-heading" className="flex flex-col gap-4">
      <h4 id="venues-heading" className="text-ink font-sans text-lg font-semibold">
        {t("admin.venue.title")}
      </h4>
      {doc.venues.length === 0 ? <p className="text-muted">{t("admin.venue.empty")}</p> : null}
      {doc.venues.map((venue, index) => {
        const urlBad = Boolean(venue.mapUrl) && normalizeUrl(venue.mapUrl ?? "") === null;
        return (
          <ItemCard
            key={venue.id}
            id={`venue-${venue.id}`}
            title={t("admin.venue.itemTitle", { number: index + 1 })}
            removeLabel={t("admin.venue.remove", { number: index + 1 })}
            onRemove={() => setVenues(doc.venues.filter((x) => x.id !== venue.id))}
          >
            <LocalizedField
              label={t("admin.venue.name")}
              required
              locales={ctx.locales}
              value={venue.name}
              maxLength={200}
              onChange={(name) => patch(venue.id, { name: name ?? {} })}
            />
            <Field
              label={t("admin.venue.address")}
              hint={t("admin.venue.addressHint")}
              autoComplete="off"
              value={venue.address}
              maxLength={250}
              // Souřadnice patří k adrese: po úpravě se zahodí a mapa je hledá znovu.
              onChange={(e) => patch(venue.id, { address: e.target.value, lat: null, lng: null })}
            />
            {mapVenueIds.includes(venue.id) && !venue.isPrivate ? (
              <VenueGeo venue={venue} ctx={ctx} />
            ) : null}
            <Checkbox
              label={t("admin.venue.private")}
              checked={venue.isPrivate}
              onChange={(e) => patch(venue.id, { isPrivate: e.target.checked })}
            />
            <Note tone="info">{t("admin.venue.privateHint")}</Note>
            {venue.isPrivate && !ctx.guestPinReady ? (
              <Note>{t("admin.gifts.pinMissing")}</Note>
            ) : null}
            <LocalizedField
              label={t("admin.venue.directions")}
              multiline
              locales={ctx.locales}
              value={venue.directions}
              onChange={(directions) => patch(venue.id, { directions })}
            />
            <Field
              label={t("admin.venue.map")}
              hint={t("admin.venue.mapHint")}
              type="url"
              inputMode="url"
              autoComplete="off"
              maxLength={500}
              value={venue.mapUrl ?? ""}
              error={urlBad ? t("admin.error.url") : undefined}
              onChange={(e) => patch(venue.id, { mapUrl: e.target.value || null })}
            />
          </ItemCard>
        );
      })}
      <div>
        <AddButton
          onClick={() =>
            setVenues([
              ...doc.venues,
              {
                id: newId(),
                name: {},
                address: "",
                isPrivate: false,
                directions: null,
                mapUrl: null,
                lat: null,
                lng: null,
              },
            ])
          }
          disabled={doc.venues.length >= 20}
        >
          {t("admin.venue.add")}
        </AddButton>
      </div>
    </section>
  );
}
