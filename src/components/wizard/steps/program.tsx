"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MAX_EXTRA_EVENTS, type PlaceDraft, type WizardDraft } from "@/wizard/draft";
import {
  Explain,
  fieldId,
  focusLater,
  LocalizedTextArea,
  ScreenGroup,
  TextField,
  ToggleField,
  useErrorText,
} from "../fields";
import { useT } from "../i18n";
import { useGeocode, type GeocodeStatus } from "../use-geocode";
import type { StepProps } from "./types";

type PlaceKey = "ceremony" | "reception";
export type PlaceGeoStatus = Record<PlaceKey, GeocodeStatus | null>;

/** Adresa místa, kterou je potřeba najít na mapě (mapa zapnutá, místo vyplněné, souřadnice chybí). */
function pendingAddress(draft: WizardDraft, which: PlaceKey): string | null {
  const part = draft[which];
  const address = part.venueAddress.trim();
  const used =
    which === "ceremony"
      ? part.enabled
      : part.enabled && !(draft.reception.sameVenue && draft.ceremony.enabled);
  // Místo bez názvu web nevykreslí (`resolvePlaces`), nemá smysl ho hledat.
  const named = part.venueName.trim() !== "";
  if (!draft.showMap || !used || !named || address === "" || part.geo?.query === address) {
    return null;
  }
  return address;
}

/**
 * Souřadnice míst pro mapu. Běží v celém průvodci (ne jen v kroku 4), aby se hledání nepřerušilo
 * přechodem na další krok; nalezené místo se zapíše do konceptu k adrese, ke které se hledalo.
 */
export function useDraftGeocode(draft: WizardDraft, update: StepProps["update"]): PlaceGeoStatus {
  const found =
    (which: PlaceKey, address: string) => (hit: { lat: number; lng: number; label: string }) =>
      update((d) =>
        d[which].venueAddress.trim() === address
          ? { ...d, [which]: { ...d[which], geo: { query: address, ...hit } } }
          : d,
      );
  const ceremony = pendingAddress(draft, "ceremony");
  const reception = pendingAddress(draft, "reception");
  return {
    ceremony: useGeocode(ceremony, found("ceremony", ceremony ?? "")),
    reception: useGeocode(reception, found("reception", reception ?? "")),
  };
}

/** Místo konání a poznámka, jak se tam dostat: zadává se jednou, hostina může využít místo obřadu. */
function VenueFields({
  which,
  draft,
  update,
  errors,
  geoStatus,
}: Pick<StepProps, "draft" | "update" | "errors"> & {
  which: PlaceKey;
  geoStatus: GeocodeStatus | null;
}) {
  const t = useT();
  const errorText = useErrorText();
  const part = draft[which];
  const patch = (change: Partial<PlaceDraft>) =>
    update((d) => ({ ...d, [which]: { ...d[which], ...change } }));
  const address = part.venueAddress.trim();
  // Souřadnice platí jen k adrese, ke které se hledaly; po úpravě adresy průvodce hledá znovu.
  const located = address !== "" && part.geo?.query === address;

  return (
    <>
      <TextField
        field={`${which}-venueName`}
        label={t("wizard.venue.name.label")}
        hint={t("wizard.venue.name.hint")}
        value={part.venueName}
        onValueChange={(venueName) => patch({ venueName })}
        error={errorText(errors, `${which}-venueName`)}
        autoComplete="off"
        maxLength={120}
      />
      <TextField
        field={`${which}-venueAddress`}
        label={t("wizard.venue.address.label")}
        hint={t("wizard.venue.address.hint")}
        value={part.venueAddress}
        onValueChange={(venueAddress) => patch({ venueAddress })}
        error={errorText(errors, `${which}-venueAddress`)}
        autoComplete="off"
        maxLength={250}
      />
      {/* Oblast zůstává v DOM, aby čtečky výsledek hledání ohlásily (vložená i s textem by zmlkla). */}
      <p
        role="status"
        className={draft.showMap && address !== "" ? "text-muted -mt-2 text-sm" : "sr-only"}
      >
        {draft.showMap && address !== ""
          ? located && part.geo
            ? t("wizard.map.found", { place: part.geo.label })
            : t(`wizard.map.${geoStatus ?? "searching"}`)
          : ""}
      </p>
      <LocalizedTextArea
        field={`${which}-directions`}
        label={t("wizard.venue.directions.label")}
        hint={t("wizard.venue.directions.hint")}
        value={part.directions}
        onValueChange={(directions) => patch({ directions })}
        siteLocales={draft.locales}
        defaultLocale={draft.defaultLocale}
        maxLength={1000}
      />
    </>
  );
}

/** Krok 4: program dne a místo. Všechno je nepovinné a jde to doplnit později ve správě webu. */
export function StepProgram({
  draft,
  update,
  errors,
  screen,
  mobile,
  geoStatus,
}: StepProps & { geoStatus: PlaceGeoStatus }) {
  const t = useT();
  const errorText = useErrorText();
  const { ceremony, reception } = draft;
  const sharesVenue = reception.sameVenue && ceremony.enabled;

  const patch = (which: PlaceKey, change: Partial<PlaceDraft> & { sameVenue?: boolean }) =>
    update((d) => ({ ...d, [which]: { ...d[which], ...change } }));

  const addEvent = () => {
    const id = globalThis.crypto.randomUUID();
    update((d) => ({
      ...d,
      extraEvents:
        d.extraEvents.length >= MAX_EXTRA_EVENTS
          ? d.extraEvents
          : [...d.extraEvents, { id, title: {}, time: "" }],
    }));
    setTimeout(
      () => document.getElementById(fieldId(`extra-${draft.extraEvents.length}-title`))?.focus(),
      0,
    );
  };

  const removeEvent = (id: string) => {
    update((d) => ({ ...d, extraEvents: d.extraEvents.filter((event) => event.id !== id) }));
    focusLater(fieldId("extra-add"));
  };

  const patchEvent = (id: string, change: Partial<WizardDraft["extraEvents"][number]>) =>
    update((d) => ({
      ...d,
      extraEvents: d.extraEvents.map((event) =>
        event.id === id ? { ...event, ...change } : event,
      ),
    }));

  return (
    <>
      <ScreenGroup index={0} screen={screen} mobile={mobile}>
        <ToggleField
          label={t("wizard.ceremony.enable")}
          description={t("wizard.ceremony.enableHint")}
          checked={ceremony.enabled}
          onCheckedChange={(enabled) => patch("ceremony", { enabled })}
        />
        {ceremony.enabled ? (
          <>
            <TextField
              field="ceremony-time"
              type="time"
              label={t("wizard.ceremony.time")}
              value={ceremony.time}
              onValueChange={(time) => patch("ceremony", { time })}
              error={errorText(errors, "ceremony-time")}
              autoComplete="off"
              required
            />
            <VenueFields
              which="ceremony"
              draft={draft}
              update={update}
              errors={errors}
              geoStatus={geoStatus.ceremony}
            />
          </>
        ) : null}
      </ScreenGroup>

      <ScreenGroup index={1} screen={screen} mobile={mobile}>
        <ToggleField
          label={t("wizard.reception.enable")}
          description={t("wizard.reception.enableHint")}
          checked={reception.enabled}
          onCheckedChange={(enabled) => patch("reception", { enabled })}
        />
        {reception.enabled ? (
          <>
            <TextField
              field="reception-time"
              type="time"
              label={t("wizard.reception.time")}
              value={reception.time}
              onValueChange={(time) => patch("reception", { time })}
              error={errorText(errors, "reception-time")}
              autoComplete="off"
              required
            />
            {ceremony.enabled ? (
              <ToggleField
                label={t("wizard.reception.sameVenue")}
                checked={reception.sameVenue}
                onCheckedChange={(sameVenue) => patch("reception", { sameVenue })}
              />
            ) : null}
            {sharesVenue ? null : (
              <VenueFields
                which="reception"
                draft={draft}
                update={update}
                errors={errors}
                geoStatus={geoStatus.reception}
              />
            )}
          </>
        ) : null}
        {ceremony.enabled || reception.enabled ? (
          <>
            <ToggleField
              label={t("wizard.map.enable")}
              description={t("wizard.map.enableHint")}
              checked={draft.showMap}
              onCheckedChange={(showMap) => update((d) => ({ ...d, showMap }))}
            />
            <Explain topic="map" />
          </>
        ) : null}
      </ScreenGroup>

      <ScreenGroup index={2} screen={screen} mobile={mobile}>
        <p className="text-muted text-sm">{t("wizard.extra.hint")}</p>
        {draft.extraEvents.map((event, index) => (
          <Card key={event.id} tone="linen" className="flex flex-col gap-4">
            <h2 className="text-ink text-lg font-medium">
              {t("wizard.extra.item", { number: index + 1 })}
            </h2>
            <TextField
              field={`extra-${index}-title`}
              label={t("wizard.extra.title")}
              value={event.title[draft.defaultLocale] ?? ""}
              onValueChange={(value) =>
                patchEvent(event.id, { title: { ...event.title, [draft.defaultLocale]: value } })
              }
              error={errorText(errors, `extra-${index}-title`)}
              autoComplete="off"
              maxLength={120}
              lang={draft.defaultLocale}
            />
            {draft.locales
              .filter((locale) => locale !== draft.defaultLocale)
              .map((locale) => (
                <TextField
                  key={locale}
                  field={`extra-${index}-title-${locale}`}
                  label={t("wizard.localized.other", { language: t(`wizard.language.${locale}`) })}
                  value={event.title[locale] ?? ""}
                  onValueChange={(value) =>
                    patchEvent(event.id, { title: { ...event.title, [locale]: value } })
                  }
                  autoComplete="off"
                  maxLength={120}
                  lang={locale}
                />
              ))}
            <TextField
              field={`extra-${index}-time`}
              type="time"
              label={t("wizard.extra.time")}
              value={event.time}
              onValueChange={(time) => patchEvent(event.id, { time })}
              error={errorText(errors, `extra-${index}-time`)}
              autoComplete="off"
              required
            />
            <Button
              variant="text"
              className="self-start"
              aria-label={t("wizard.extra.removeLabel", { number: index + 1 })}
              onClick={() => removeEvent(event.id)}
            >
              {t("wizard.remove")}
            </Button>
          </Card>
        ))}
        {draft.extraEvents.length < MAX_EXTRA_EVENTS ? (
          <Button
            id={fieldId("extra-add")}
            variant="secondary"
            className="self-start"
            onClick={addEvent}
          >
            {t("wizard.extra.add")}
          </Button>
        ) : (
          <p className="text-muted text-sm">{t("wizard.extra.max", { max: MAX_EXTRA_EVENTS })}</p>
        )}
      </ScreenGroup>
    </>
  );
}
