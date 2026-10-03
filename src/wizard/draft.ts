import { z } from "zod";
import { pinProblem } from "@/auth/pin-format";
import { locales, type Locale } from "@/i18n/config";
import { NAME_MAX_LENGTH } from "@/lib/wizard-link";
import { hasPalette, templateKeys, templates, type TemplateKey } from "@/site/themes/palettes";
import { validateTemplatePalette } from "@/site/themes/validate";
import { normalizeUrl, normalizePhone } from "./normalize";
import { slugFromNames, slugProblem } from "./slug";

/**
 * Rozpracovaný průvodce (draft): jediný tvar, který drží prohlížeč (localStorage), posílá se
 * serveru k uložení a ze kterého vzniká živý náhled i zveřejněný snímek webu. Texty páru nejsou
 * typograficky upravené (typo() běží až při vykreslení webu).
 *
 * Co smí server uložit, určuje `serverDraft`: PIN hostů v prostém tvaru se na server nikdy
 * neukládá (v databázi je jen jeho hash po zveřejnění).
 */

export const WIZARD_VERSION = 1;
export const STEP_COUNT = 9;
/** Kroky potřebné k existenci webu (FR-WZ-2); kroky 4 až 8 jdou přeskočit, krok 9 uzavírá. */
export const REQUIRED_STEPS = [1, 2, 3] as const;
export const SKIPPABLE_STEPS = [4, 5, 6, 7, 8] as const;

export const STEP_KEYS = [
  "names",
  "date",
  "template",
  "program",
  "info",
  "rsvp",
  "access",
  "review",
  "finish",
] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export const MAX_EXTRA_EVENTS = 5;
export const MAX_LODGING = 3;
export const MAX_CONTACTS = 3;

const uuid = z.string().uuid();
const localeSchema = z.enum(locales);
const date = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);
const time = z.union([z.literal(""), z.string().regex(/^\d{2}:\d{2}$/)]);

/** Text po jazycích s horní mezí délky (obrana proti obřím datům; limity jsou výchozí návrh). */
const localized = (max: number) =>
  z
    .object({ cs: z.string().max(max).optional(), en: z.string().max(max).optional() })
    .strict()
    .default({});

const place = z.object({
  enabled: z.boolean().default(false),
  time: time.default(""),
  venueName: z.string().max(120).default(""),
  venueAddress: z.string().max(250).default(""),
  directions: localized(1000),
  /**
   * Souřadnice adresy pro mapu (hledání na serveru, Nominatim). Platí jen pro adresu v `query`:
   * po úpravě adresy se nepoužijí a průvodce hledá znovu.
   */
  geo: z
    .object({
      query: z.string().max(250),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      label: z.string().max(300),
    })
    .nullable()
    .default(null),
});

const idsSchema = z.object({
  venueA: uuid,
  venueB: uuid,
  ceremony: uuid,
  reception: uuid,
  hero: uuid,
  program: uuid,
  venue: uuid,
  lodging: uuid,
  dresscode: uuid,
  contact: uuid,
  rsvp: uuid,
});

export const wizardDraftSchema = z.object({
  version: z.literal(WIZARD_VERSION),
  ids: idsSchema,
  /** Svatba v databázi po prvním uložení; do té doby koncept existuje jen v prohlížeči. */
  weddingId: uuid.nullable().default(null),

  // 1. Jména a jazyk
  partnerA: z.string().max(NAME_MAX_LENGTH).default(""),
  partnerB: z.string().max(NAME_MAX_LENGTH).default(""),
  locales: z.array(localeSchema).min(1).max(2),
  defaultLocale: localeSchema,

  // 2. Datum a adresa
  startsOn: date.default(""),
  endsOn: date.default(""),
  slug: z.string().max(80).default(""),
  /** Adresu pár upravil ručně; do té doby ji průvodce odvozuje z jmen. */
  slugEdited: z.boolean().default(false),

  // 3. Šablona a paleta
  template: z.enum(templateKeys),
  palette: z.string().max(40),

  // 4. Program a místo
  ceremony: place,
  reception: place.extend({ sameVenue: z.boolean().default(true) }),
  /** Statická mapa místa konání na webu (odkazy na Google Maps a Mapy.cz k ní). */
  showMap: z.boolean().default(false),
  extraEvents: z
    .array(
      z.object({
        id: uuid,
        title: localized(120),
        time: time.default(""),
      }),
    )
    .max(MAX_EXTRA_EVENTS)
    .default([]),

  // 5. Praktické informace
  dressCode: localized(1000),
  lodging: z
    .array(
      z.object({
        id: uuid,
        name: z.string().max(120).default(""),
        description: localized(500),
        url: z.string().max(300).default(""),
      }),
    )
    .max(MAX_LODGING)
    .default([]),
  transport: localized(1000),
  contacts: z
    .array(
      z.object({
        id: uuid,
        name: z.string().max(100).default(""),
        email: z.string().max(254).default(""),
        phone: z.string().max(30).default(""),
      }),
    )
    .max(MAX_CONTACTS)
    .default([]),

  // 6. Potvrzení účasti
  rsvp: z
    .object({
      deadline: date.default(""),
      plusOne: z.boolean().default(false),
      children: z.boolean().default(false),
      diet: z.boolean().default(false),
      emailConfirmation: z.boolean().default(false),
    })
    .default({
      deadline: "",
      plusOne: false,
      children: false,
      diet: false,
      emailConfirmation: false,
    }),

  // 7. Přístup a soukromí
  guestPin: z
    .object({ enabled: z.boolean().default(false), pin: z.string().max(12).default("") })
    .default({ enabled: false, pin: "" }),

  // Průběh
  progress: z
    .object({
      /** Aktuální krok (1 až 9). */
      step: z.number().int().min(1).max(STEP_COUNT).default(1),
      /** Nejdál dosažený krok; k němu se jde vrátit tlačítkem v ukazateli. */
      reached: z.number().int().min(1).max(STEP_COUNT).default(1),
      /** Kroky 4 až 8 přeskočené tlačítkem „Přeskočit“. */
      skipped: z.array(z.number().int().min(4).max(8)).default([]),
      /** Kroky dokončené tlačítkem „Další“. */
      done: z.array(z.number().int().min(1).max(STEP_COUNT)).default([]),
    })
    .default({ step: 1, reached: 1, skipped: [], done: [] }),
  /** Které měřicí události už se odeslaly (každá jednou za koncept). */
  tracking: z
    .object({ started: z.boolean().default(false), steps: z.array(z.number()).default([]) })
    .default({ started: false, steps: [] }),
  updatedAt: z.string().max(40).default(""),
});

export type WizardDraft = z.infer<typeof wizardDraftSchema>;
export type PlaceDraft = WizardDraft["ceremony"];

type UuidFactory = () => string;

const defaultUuid: UuidFactory = () => globalThis.crypto.randomUUID();

export interface CreateDraftOptions {
  locale: Locale;
  partnerA?: string;
  partnerB?: string;
  /** Jazyk webu z úvodní stránky (`jazyk=en`); jinak jazyk rozhraní průvodce. */
  siteLocale?: Locale;
  newId?: UuidFactory;
  now?: Date;
}

function clean(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX_LENGTH);
}

/** Prázdný koncept; jména a jazyk z úvodní stránky (FR-LP-5) se předvyplní. */
export function createDraft(options: CreateDraftOptions): WizardDraft {
  const id = options.newId ?? defaultUuid;
  const siteLocale = options.siteLocale ?? options.locale;
  const template: TemplateKey = "eukalyptus";
  const partnerA = clean(options.partnerA);
  const partnerB = clean(options.partnerB);
  const emptyPlace = (): PlaceDraft => ({
    enabled: false,
    time: "",
    venueName: "",
    venueAddress: "",
    directions: {},
    geo: null,
  });
  return {
    version: WIZARD_VERSION,
    ids: {
      venueA: id(),
      venueB: id(),
      ceremony: id(),
      reception: id(),
      hero: id(),
      program: id(),
      venue: id(),
      lodging: id(),
      dresscode: id(),
      contact: id(),
      rsvp: id(),
    },
    weddingId: null,
    partnerA,
    partnerB,
    locales: [siteLocale],
    defaultLocale: siteLocale,
    startsOn: "",
    endsOn: "",
    slug: slugFromNames(partnerA, partnerB, siteLocale),
    slugEdited: false,
    template,
    palette: templates[template].defaultPalette,
    ceremony: emptyPlace(),
    reception: { ...emptyPlace(), sameVenue: true },
    showMap: false,
    extraEvents: [],
    dressCode: {},
    lodging: [],
    transport: {},
    contacts: [],
    rsvp: { deadline: "", plusOne: false, children: false, diet: false, emailConfirmation: false },
    guestPin: { enabled: false, pin: "" },
    progress: { step: 1, reached: 1, skipped: [], done: [] },
    tracking: { started: false, steps: [] },
    updatedAt: (options.now ?? new Date()).toISOString(),
  };
}

/** Bezpečné načtení z úložiště prohlížeče nebo ze serveru; poškozená data jsou `null`. */
export function parseDraft(raw: unknown): WizardDraft | null {
  const parsed = wizardDraftSchema.safeParse(raw);
  return parsed.success ? normalizeDraft(parsed.data) : null;
}

/** Sjednotí vzájemně závislá pole (výchozí jazyk mezi jazyky, paleta patří šabloně). */
export function normalizeDraft(draft: WizardDraft): WizardDraft {
  const next = { ...draft };
  if (!next.locales.includes(next.defaultLocale)) next.defaultLocale = next.locales[0];
  if (!hasPalette(next.template, next.palette)) {
    next.palette = templates[next.template].defaultPalette;
  }
  return next;
}

/** Změna šablony vrací výchozí paletu nové šablony (paleta jiné šablony by neplatila). */
export function withTemplate(draft: WizardDraft, template: TemplateKey): WizardDraft {
  if (draft.template === template) return draft;
  return { ...draft, template, palette: templates[template].defaultPalette };
}

/** Jména se změnila: adresu odvozuje průvodce, dokud ji pár ručně neupraví. */
export function withNames(draft: WizardDraft, partnerA: string, partnerB: string): WizardDraft {
  const next = { ...draft, partnerA, partnerB };
  if (!draft.slugEdited) next.slug = slugFromNames(partnerA, partnerB, draft.defaultLocale);
  return next;
}

/** Jazyky webu: nejméně jeden; výchozí jazyk zůstane mezi nimi. */
export function withLocales(
  draft: WizardDraft,
  siteLocales: readonly Locale[],
  defaultLocale: Locale,
): WizardDraft {
  const list = locales.filter((locale) => siteLocales.includes(locale));
  const nextLocales = list.length > 0 ? list : [defaultLocale];
  const next = {
    ...draft,
    locales: nextLocales,
    defaultLocale: nextLocales.includes(defaultLocale) ? defaultLocale : nextLocales[0],
  };
  if (!draft.slugEdited) {
    next.slug = slugFromNames(next.partnerA, next.partnerB, next.defaultLocale);
  }
  return next;
}

/** Podoba draftu, kterou smí vidět server: bez PINu v prostém tvaru a bez měření. */
export function serverDraft(draft: WizardDraft): WizardDraft {
  return {
    ...draft,
    guestPin: { enabled: draft.guestPin.enabled, pin: "" },
    tracking: { started: false, steps: [] },
  };
}

// --- kontrola ----------------------------------------------------------------------------

export type IssueCode =
  | "partner_required"
  | "locales_required"
  | "date_required"
  | "date_invalid"
  | "end_before_start"
  | "slug_empty"
  | "slug_too_short"
  | "slug_too_long"
  | "slug_format"
  | "slug_reserved"
  | "palette_invalid"
  | "palette_contrast"
  | "time_required"
  | "time_invalid"
  | "place_incomplete"
  | "extra_title_required"
  | "lodging_name_required"
  | "url_invalid"
  | "contact_name_required"
  | "contact_email_invalid"
  | "contact_phone_invalid"
  | "deadline_invalid"
  | "deadline_after_start"
  | "pin_required"
  | "pin_format"
  | "pin_trivial";

export interface Issue {
  /** Krok průvodce (1 až 9), ve kterém jde chybu opravit. */
  step: number;
  /** Název pole pro zaměření a odkaz z přehledu chyb. */
  field: string;
  code: IssueCode;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function isRealTime(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
}

function placeIssues(draft: WizardDraft, which: "ceremony" | "reception", out: Issue[]): void {
  const part = draft[which];
  if (!part.enabled) return;
  if (part.time === "") out.push({ step: 4, field: `${which}-time`, code: "time_required" });
  else if (!isRealTime(part.time))
    out.push({ step: 4, field: `${which}-time`, code: "time_invalid" });

  const sharesVenue = which === "reception" && draft.reception.sameVenue && draft.ceremony.enabled;
  if (sharesVenue) return;
  const name = part.venueName.trim();
  const address = part.venueAddress.trim();
  if ((name === "") !== (address === "")) {
    out.push({
      step: 4,
      field: name === "" ? `${which}-venueName` : `${which}-venueAddress`,
      code: "place_incomplete",
    });
  }
}

/** Všechny chyby draftu; prázdný seznam = web jde zveřejnit. */
export function validateDraft(draft: WizardDraft): Issue[] {
  const issues: Issue[] = [];

  // 1. Jména a jazyk
  if (draft.partnerA.trim() === "")
    issues.push({ step: 1, field: "partnerA", code: "partner_required" });
  if (draft.partnerB.trim() === "")
    issues.push({ step: 1, field: "partnerB", code: "partner_required" });
  if (draft.locales.length === 0)
    issues.push({ step: 1, field: "locales", code: "locales_required" });

  // 2. Datum a adresa
  if (draft.startsOn === "") issues.push({ step: 2, field: "startsOn", code: "date_required" });
  else if (!isRealDate(draft.startsOn))
    issues.push({ step: 2, field: "startsOn", code: "date_invalid" });
  if (draft.endsOn !== "") {
    if (!isRealDate(draft.endsOn)) issues.push({ step: 2, field: "endsOn", code: "date_invalid" });
    else if (draft.startsOn !== "" && draft.endsOn < draft.startsOn) {
      issues.push({ step: 2, field: "endsOn", code: "end_before_start" });
    }
  }
  const problem = slugProblem(draft.slug);
  if (problem) issues.push({ step: 2, field: "slug", code: `slug_${problem}` as IssueCode });

  // 3. Šablona a paleta
  if (!hasPalette(draft.template, draft.palette)) {
    issues.push({ step: 3, field: "palette", code: "palette_invalid" });
  } else if (!validateTemplatePalette(draft.template, draft.palette).ok) {
    // Paleta s nízkým kontrastem se nesmí zveřejnit (FR-WEB-3, WCAG 1.4.3).
    issues.push({ step: 3, field: "palette", code: "palette_contrast" });
  }

  // 4. Program a místo
  placeIssues(draft, "ceremony", issues);
  placeIssues(draft, "reception", issues);
  draft.extraEvents.forEach((event, index) => {
    const title = event.title.cs?.trim() || event.title.en?.trim() || "";
    if (title === "")
      issues.push({ step: 4, field: `extra-${index}-title`, code: "extra_title_required" });
    if (event.time === "")
      issues.push({ step: 4, field: `extra-${index}-time`, code: "time_required" });
    else if (!isRealTime(event.time))
      issues.push({ step: 4, field: `extra-${index}-time`, code: "time_invalid" });
  });

  // 5. Praktické informace
  draft.lodging.forEach((item, index) => {
    if (item.name.trim() === "") {
      issues.push({ step: 5, field: `lodging-${index}-name`, code: "lodging_name_required" });
    }
    if (item.url.trim() !== "" && normalizeUrl(item.url) === null) {
      issues.push({ step: 5, field: `lodging-${index}-url`, code: "url_invalid" });
    }
  });
  draft.contacts.forEach((contact, index) => {
    if (contact.name.trim() === "") {
      issues.push({ step: 5, field: `contact-${index}-name`, code: "contact_name_required" });
    }
    if (contact.email.trim() !== "" && !EMAIL.test(contact.email.trim())) {
      issues.push({ step: 5, field: `contact-${index}-email`, code: "contact_email_invalid" });
    }
    if (contact.phone.trim() !== "" && normalizePhone(contact.phone) === null) {
      issues.push({ step: 5, field: `contact-${index}-phone`, code: "contact_phone_invalid" });
    }
  });

  // 6. Potvrzení účasti
  if (draft.rsvp.deadline !== "") {
    if (!isRealDate(draft.rsvp.deadline)) {
      issues.push({ step: 6, field: "deadline", code: "deadline_invalid" });
    } else if (draft.startsOn !== "" && draft.rsvp.deadline > draft.startsOn) {
      issues.push({ step: 6, field: "deadline", code: "deadline_after_start" });
    }
  }

  // 7. Přístup a soukromí
  if (draft.guestPin.enabled) {
    if (draft.guestPin.pin === "") issues.push({ step: 7, field: "pin", code: "pin_required" });
    else {
      const pinIssue = pinProblem(draft.guestPin.pin);
      if (pinIssue === "format") issues.push({ step: 7, field: "pin", code: "pin_format" });
      if (pinIssue === "trivial") issues.push({ step: 7, field: "pin", code: "pin_trivial" });
    }
  }

  return issues;
}

export function issuesForSteps(draft: WizardDraft, steps: readonly number[]): Issue[] {
  return validateDraft(draft).filter((issue) => steps.includes(issue.step));
}

/** Koncept se smí poprvé uložit na server (a rezervovat adresu), jen když kroky 1 až 3 sedí. */
export function canSaveToServer(draft: WizardDraft): boolean {
  return issuesForSteps(draft, REQUIRED_STEPS).length === 0;
}

export function canPublish(draft: WizardDraft): boolean {
  return validateDraft(draft).length === 0;
}

/** Stav kroku pro ukazatel postupu: hotový, přeskočený, s chybou, nebo ještě nenavštívený. */
export type StepState = "done" | "skipped" | "invalid" | "todo";

export function stepState(draft: WizardDraft, step: number): StepState {
  const { done, skipped, reached } = draft.progress;
  const visited = done.includes(step) || skipped.includes(step) || step < reached;
  if (visited && validateDraft(draft).some((issue) => issue.step === step)) return "invalid";
  if (skipped.includes(step)) return "skipped";
  if (done.includes(step)) return "done";
  return "todo";
}

export const SLUG_ISSUE_CODES: readonly IssueCode[] = [
  "slug_empty",
  "slug_too_short",
  "slug_too_long",
  "slug_format",
  "slug_reserved",
];
