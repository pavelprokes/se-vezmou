import type { RsvpView, UnlistedFormView } from "./types";

/** Společná data jednotkových testů RSVP (vymyšlená rodina Novákových, nikdy skutečná). */

export const WEDDING = "11111111-1111-4111-8111-111111111111";
export const HOUSEHOLD = "22222222-2222-4222-8222-222222222222";
export const G_JAN = "33333333-3333-4333-8333-000000000001";
export const G_MARIE = "33333333-3333-4333-8333-000000000002";
export const G_ANEZKA = "33333333-3333-4333-8333-000000000003";
export const E_OBRAD = "44444444-4444-4444-8444-000000000001";
export const E_HOSTINA = "44444444-4444-4444-8444-000000000002";

export const ALL_FLAGS = {
  plus_one: true,
  children: true,
  diet: true,
  lodging: true,
  transport: true,
  song: true,
};

const events: RsvpView["events"] = [
  {
    id: E_OBRAD,
    kind: "ceremony",
    title: { cs: "Svatební obřad", en: "Wedding ceremony" },
    description: null,
    starts_at: "2027-06-19T12:00:00+00:00",
    ends_at: null,
  },
  {
    id: E_HOSTINA,
    kind: "reception",
    title: { cs: "Svatební hostina", en: "Wedding dinner" },
    description: { cs: "Menu zahrnuje vegetariánskou variantu." },
    starts_at: "2027-06-19T15:30:00+00:00",
    ends_at: null,
  },
];

export function householdView(overrides: Partial<RsvpView> = {}): RsvpView {
  return {
    household_id: HOUSEHOLD,
    wedding: { timezone: "Europe/Prague", default_locale: "cs" },
    guests: [
      { id: G_JAN, display_name: "Jan Novák", is_child: false, age: null },
      { id: G_MARIE, display_name: "Marie Nováková", is_child: false, age: null },
      { id: G_ANEZKA, display_name: "Anežka Nováková", is_child: true, age: 9 },
    ],
    events,
    invitations: [
      { guest_id: G_JAN, event_id: E_OBRAD },
      { guest_id: G_JAN, event_id: E_HOSTINA },
      { guest_id: G_MARIE, event_id: E_OBRAD },
      { guest_id: G_MARIE, event_id: E_HOSTINA },
      // dítě je pozváno jen na obřad
      { guest_id: G_ANEZKA, event_id: E_OBRAD },
    ],
    settings: { enabled_questions: ALL_FLAGS, email_confirmation: true },
    questions: [],
    response: null,
    ...overrides,
  };
}

export function unlistedView(overrides: Partial<UnlistedFormView> = {}): UnlistedFormView {
  return {
    wedding: { timezone: "Europe/Prague", default_locale: "cs" },
    events,
    settings: { enabled_questions: { children: true, diet: true }, email_confirmation: false },
    questions: [],
    ...overrides,
  };
}

/** Odeslaný formulář z dvojic název pole a hodnota (opakované názvy se zachovají). */
export function formOf(entries: [string, string][]): FormData {
  const form = new FormData();
  for (const [name, value] of entries) form.append(name, value);
  return form;
}
