"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MAX_CONTACTS, MAX_LODGING, type WizardDraft } from "@/wizard/draft";
import { fieldId, LocalizedTextArea, ScreenGroup, TextField, useErrorText } from "../fields";
import { useT } from "../i18n";
import type { StepProps } from "./types";

type Lodging = WizardDraft["lodging"][number];
type Contact = WizardDraft["contacts"][number];

/** Krok 5: praktické informace pro hosty (dress code, ubytování, doprava, kontakt). */
export function StepInfo({ draft, update, errors, screen, mobile }: StepProps) {
  const t = useT();
  const errorText = useErrorText();

  const addLodging = () => {
    const id = globalThis.crypto.randomUUID();
    update((d) =>
      d.lodging.length >= MAX_LODGING
        ? d
        : { ...d, lodging: [...d.lodging, { id, name: "", description: {}, url: "" }] },
    );
    setTimeout(
      () => document.getElementById(fieldId(`lodging-${draft.lodging.length}-name`))?.focus(),
      0,
    );
  };
  const patchLodging = (id: string, change: Partial<Lodging>) =>
    update((d) => ({
      ...d,
      lodging: d.lodging.map((item) => (item.id === id ? { ...item, ...change } : item)),
    }));

  const addContact = () => {
    const id = globalThis.crypto.randomUUID();
    update((d) =>
      d.contacts.length >= MAX_CONTACTS
        ? d
        : { ...d, contacts: [...d.contacts, { id, name: "", email: "", phone: "" }] },
    );
    setTimeout(
      () => document.getElementById(fieldId(`contact-${draft.contacts.length}-name`))?.focus(),
      0,
    );
  };
  const patchContact = (id: string, change: Partial<Contact>) =>
    update((d) => ({
      ...d,
      contacts: d.contacts.map((item) => (item.id === id ? { ...item, ...change } : item)),
    }));

  return (
    <>
      <ScreenGroup index={0} screen={screen} mobile={mobile}>
        <LocalizedTextArea
          field="dressCode"
          label={t("wizard.dressCode.label")}
          hint={t("wizard.dressCode.hint")}
          value={draft.dressCode}
          onValueChange={(dressCode) => update((d) => ({ ...d, dressCode }))}
          siteLocales={draft.locales}
          defaultLocale={draft.defaultLocale}
          maxLength={1000}
        />
      </ScreenGroup>

      <ScreenGroup index={1} screen={screen} mobile={mobile}>
        <p className="text-muted text-sm">{t("wizard.lodging.hint")}</p>
        {draft.lodging.map((item, index) => (
          <Card key={item.id} tone="linen" className="flex flex-col gap-4">
            <h3 className="text-ink text-lg font-medium">
              {t("wizard.lodging.item", { number: index + 1 })}
            </h3>
            <TextField
              field={`lodging-${index}-name`}
              label={t("wizard.lodging.name")}
              value={item.name}
              onValueChange={(name) => patchLodging(item.id, { name })}
              error={errorText(errors, `lodging-${index}-name`)}
              autoComplete="off"
              maxLength={120}
              lang={draft.defaultLocale}
            />
            <TextField
              field={`lodging-${index}-url`}
              type="url"
              inputMode="url"
              label={t("wizard.lodging.url")}
              hint={t("wizard.lodging.urlHint")}
              value={item.url}
              onValueChange={(url) => patchLodging(item.id, { url })}
              error={errorText(errors, `lodging-${index}-url`)}
              autoComplete="off"
              maxLength={300}
            />
            <LocalizedTextArea
              field={`lodging-${index}-description`}
              label={t("wizard.lodging.description")}
              value={item.description}
              onValueChange={(description) => patchLodging(item.id, { description })}
              siteLocales={draft.locales}
              defaultLocale={draft.defaultLocale}
              maxLength={500}
              rows={2}
            />
            <Button
              variant="text"
              className="self-start"
              aria-label={t("wizard.lodging.removeLabel", { number: index + 1 })}
              onClick={() =>
                update((d) => ({
                  ...d,
                  lodging: d.lodging.filter((entry) => entry.id !== item.id),
                }))
              }
            >
              {t("wizard.remove")}
            </Button>
          </Card>
        ))}
        {draft.lodging.length < MAX_LODGING ? (
          <Button variant="secondary" className="self-start" onClick={addLodging}>
            {t("wizard.lodging.add")}
          </Button>
        ) : (
          <p className="text-muted text-sm">{t("wizard.lodging.max", { max: MAX_LODGING })}</p>
        )}
      </ScreenGroup>

      <ScreenGroup index={2} screen={screen} mobile={mobile}>
        <LocalizedTextArea
          field="transport"
          label={t("wizard.transport.label")}
          hint={t("wizard.transport.hint")}
          value={draft.transport}
          onValueChange={(transport) => update((d) => ({ ...d, transport }))}
          siteLocales={draft.locales}
          defaultLocale={draft.defaultLocale}
          maxLength={1000}
        />
      </ScreenGroup>

      <ScreenGroup index={3} screen={screen} mobile={mobile}>
        <p className="text-muted text-sm">{t("wizard.contacts.hint")}</p>
        {draft.contacts.map((contact, index) => (
          <Card key={contact.id} tone="linen" className="flex flex-col gap-4">
            <h3 className="text-ink text-lg font-medium">
              {t("wizard.contacts.item", { number: index + 1 })}
            </h3>
            <TextField
              field={`contact-${index}-name`}
              label={t("wizard.contacts.name")}
              value={contact.name}
              onValueChange={(name) => patchContact(contact.id, { name })}
              error={errorText(errors, `contact-${index}-name`)}
              autoComplete="off"
              maxLength={100}
            />
            <TextField
              field={`contact-${index}-phone`}
              type="tel"
              inputMode="tel"
              label={t("wizard.contacts.phone")}
              hint={t("wizard.contacts.phoneHint")}
              value={contact.phone}
              onValueChange={(phone) => patchContact(contact.id, { phone })}
              error={errorText(errors, `contact-${index}-phone`)}
              autoComplete="off"
              maxLength={30}
            />
            <TextField
              field={`contact-${index}-email`}
              type="email"
              inputMode="email"
              label={t("wizard.contacts.email")}
              value={contact.email}
              onValueChange={(email) => patchContact(contact.id, { email })}
              error={errorText(errors, `contact-${index}-email`)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={254}
            />
            <Button
              variant="text"
              className="self-start"
              aria-label={t("wizard.contacts.removeLabel", { number: index + 1 })}
              onClick={() =>
                update((d) => ({
                  ...d,
                  contacts: d.contacts.filter((entry) => entry.id !== contact.id),
                }))
              }
            >
              {t("wizard.remove")}
            </Button>
          </Card>
        ))}
        {draft.contacts.length < MAX_CONTACTS ? (
          <Button variant="secondary" className="self-start" onClick={addContact}>
            {t("wizard.contacts.add")}
          </Button>
        ) : (
          <p className="text-muted text-sm">{t("wizard.contacts.max", { max: MAX_CONTACTS })}</p>
        )}
      </ScreenGroup>
    </>
  );
}
