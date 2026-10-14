import { intlLocale, type Locale } from "@/i18n/config";
import { typo } from "@/i18n/typo";
import { i18nTextSchema, pick, resolvedLocale, type I18nText } from "@/site/i18n-text";
import type { RsvpView, UnlistedFormView } from "./types";

/**
 * Model formuláře RSVP: co server pošle do prohlížeče (jen hotové texty a identifikátory domácnosti
 * z lístku, nikdy seznam hostů) a stav formuláře mezi kroky. Čistý modul bez I/O, použitelný na
 * serveru i v prohlížeči (typy), testovaný samostatně.
 *
 * Názvy polí formuláře (jediné místo, které je zná klient i server):
 *   g.<hostId>.ev.<událostId>   yes | no          host ze seznamu a jeho účast
 *   g.<hostId>.diet|allergies   text              zdravotní údaje (jen při zapnuté dietě)
 *   x.<n>.kind                  adult | child     doprovod, dítě doplněné hostem, host mimo seznam
 *   x.<n>.name|age|diet|allergies, x.<n>.ev.<událostId>
 *   a.<klíč>                    odpověď na otázku (vestavěnou i vlastní, včetně vzkazu `a.message`)
 *   email, website (skrytá past)
 *   updates, updatesEmail, updatesPhone, updatesSaved   upozornění na změny (souhlas, e-mail, telefon)
 */

export type Attendance = "yes" | "no";

export interface FormEvent {
  id: string;
  kind: "ceremony" | "reception" | "other";
  title: string;
  /** `lang` prvku, jehož text se zobrazil v jiném jazyce, než je jazyk stránky (WCAG 3.1.2). */
  titleLang?: string;
  /** Datum a čas v pásmu svatby, hotový text ("sobota 19. června 2027 v 14:00"). */
  when: string;
  description: string | null;
}

export interface FormGuest {
  id: string;
  name: string;
  isChild: boolean;
  age: number | null;
  /** Události, na které je host pozván (jen na ty se ptá formulář). */
  eventIds: string[];
}

export interface FormOption {
  value: string;
  label: string;
}

export interface FormQuestion {
  key: string;
  type: "text" | "choice" | "bool";
  label: string;
  labelLang?: string;
  options: FormOption[];
  required: boolean;
  /** Otázka jen pro událost: ptá se jen toho, kdo na ni přijde. */
  eventId: string | null;
}

export interface FormFlags {
  plusOne: boolean;
  children: boolean;
  diet: boolean;
  lodging: boolean;
  transport: boolean;
  song: boolean;
  /** Vzkaz pro novomanžele (volný text do 1000 znaků). */
  message: boolean;
  /** Host může nechat e-mail (a telefon) pro upozornění na změny. */
  updates: boolean;
  emailConfirmation: boolean;
}

export interface FormExtra {
  kind: "adult" | "child";
  name: string;
  /** Věk dítěte jako text z pole (prázdné = nevyplněno). */
  age: string;
  attendance: Record<string, Attendance>;
  diet: string;
  allergies: string;
  /** Dřívější odpověď má uložené zdravotní údaje, které host nevidí (ponechají se, pokud je nezmění). */
  savedHealth?: boolean;
  /** Jméno z dřívější odpovědi: podle něj se uložené údaje najdou i po přejmenování. */
  savedName?: string;
}

export interface FormValues {
  /** `g.<hostId>.ev.<událostId>` -> yes | no */
  attendance: Record<string, Attendance>;
  /** `g.<hostId>` -> text */
  diet: Record<string, string>;
  allergies: Record<string, string>;
  extras: FormExtra[];
  /** `<klíč otázky>` -> text, `yes` | `no` u ano/ne, hodnota možnosti u výběru. */
  answers: Record<string, string>;
  email: string;
  /** `g.<hostId>` -> dřívější odpověď má uložené zdravotní údaje, které host nevidí. */
  savedHealth?: Record<string, boolean>;
  /** Dřívější odpověď má uložený e-mail, který host nevidí. */
  savedEmail?: boolean;
  /** Souhlas s upozorněním na změny (zaškrtnutí ve formuláři). */
  updates?: boolean;
  updatesEmail?: string;
  updatesPhone?: string;
  /** Dřívější odpověď má zapnutá upozornění; adresu ani telefon host nevidí. */
  savedUpdates?: boolean;
}

export interface RsvpFormModel {
  mode: "listed" | "unlisted";
  /** Hosté domácnosti (u hosta mimo seznam prázdné). */
  guests: FormGuest[];
  /** Události, na které se formulář ptá (domácnosti, nebo všechny s potvrzováním u hosta mimo seznam). */
  events: FormEvent[];
  flags: FormFlags;
  questions: FormQuestion[];
  /** Vyplněné hodnoty: dřívější odpověď domácnosti, jinak prázdné. */
  values: FormValues;
  /** Odpověď už existuje (úprava). */
  existing: boolean;
}

export type FieldErrorCode =
  "required" | "name" | "age" | "email" | "phone" | "too_long" | "choice" | "invalid";

/** Chyby podle názvu pole (`g.<id>.ev.<id>`, `x.0.name`, `a.menu`, `email`, `updatesEmail`). */
export type FieldErrors = Record<string, FieldErrorCode>;

/** Potvrzení po odeslání: kdo přijde na kterou událost (bez zdravotních údajů). */
export interface DoneSummary {
  people: { name: string; rows: { event: string; attending: boolean }[] }[];
  emailSent: boolean;
  /** Host mimo seznam: odpověď nejde upravit, rozhraní to řekne. */
  unlisted: boolean;
  /** Host se právě přihlásil k upozornění na změny (`true`) nebo se odhlásil (`false`). */
  updates?: boolean;
}

/**
 * Stav RSVP v prohlížeči. `name` = zadání jména, `form` = formulář s modelem, `closed` = RSVP
 * mezitím skončilo. `error` je chyba celého formulářového kroku; text zvolí rozhraní.
 */
export interface RsvpState {
  stage: "name" | "form" | "closed";
  error?: "name_required" | "not_found" | "generic" | "limited" | "expired" | "closed" | "invalid";
  /** Zadané jméno, aby se po neshodě nemuselo psát znovu (3.3.7). */
  value?: string;
  model?: RsvpFormModel;
  errors?: FieldErrors;
  done?: DoneSummary;
}

/** Co stránka webu páru ví o RSVP za běhu (z `loadGuestContext`): počáteční stav a volby páru. */
export interface RsvpSiteState {
  initial: RsvpState;
  /** Pár povolil odpověď hostů mimo seznam (a RSVP je otevřené). */
  allowUnlisted: boolean;
  /** Konec potvrzování účasti, je-li určen. */
  closesAt: string | null;
}

// --- sestavení modelu ---------------------------------------------------------------------

export const attendanceField = (person: string, eventId: string) => `${person}.ev.${eventId}`;
export const guestField = (guestId: string) => `g.${guestId}`;
export const extraField = (index: number) => `x.${index}`;
export const answerField = (key: string) => `a.${key}`;

/** Bezpečné `id` prvku z názvu pole (tečky a identifikátory zůstávají čitelné). */
export function fieldId(name: string): string {
  return `rsvp-${name.replace(/[^A-Za-z0-9]+/g, "-")}`;
}

function formatWhen(iso: string, locale: Locale, timeZone: string): string {
  try {
    return typo(
      new Intl.DateTimeFormat(intlLocale[locale], {
        dateStyle: "full",
        timeStyle: "short",
        timeZone,
      }).format(new Date(iso)),
      locale,
    );
  } catch {
    return "";
  }
}

function text(value: I18nText | null, locale: Locale, fallback: Locale) {
  const shown = resolvedLocale(value, locale, fallback);
  return {
    text: typo(pick(value, locale, fallback), shown ?? locale),
    lang: shown && shown !== locale ? shown : undefined,
  };
}

function flagsOf(enabled: Record<string, unknown>, emailConfirmation: boolean): FormFlags {
  const on = (key: string) => enabled[key] === true;
  return {
    plusOne: on("plus_one"),
    children: on("children"),
    diet: on("diet"),
    lodging: on("lodging"),
    transport: on("transport"),
    song: on("song"),
    message: on("message"),
    updates: on("updates"),
    emailConfirmation,
  };
}

interface Source {
  wedding: { timezone: string; default_locale: Locale };
  events: RsvpView["events"];
  settings: { enabled_questions: Record<string, unknown>; email_confirmation: boolean } | null;
  questions: RsvpView["questions"];
}

function eventsOf(source: Source, locale: Locale): FormEvent[] {
  const fallback = source.wedding.default_locale;
  return source.events.map((event) => {
    const title = text(event.title, locale, fallback);
    const description = text(event.description, locale, fallback).text;
    return {
      id: event.id,
      kind: event.kind,
      title: title.text,
      titleLang: title.lang,
      when: formatWhen(event.starts_at, locale, source.wedding.timezone),
      description: description === "" ? null : description,
    };
  });
}

function questionsOf(source: Source, locale: Locale): FormQuestion[] {
  const fallback = source.wedding.default_locale;
  const result: FormQuestion[] = [];
  for (const question of source.questions) {
    const label = text(question.label, locale, fallback);
    const options: FormOption[] = [];
    if (question.type === "choice") {
      for (const raw of question.options ?? []) {
        if (typeof raw !== "object" || raw === null) continue;
        const { value, label: optionLabel } = raw as { value?: unknown; label?: unknown };
        const parsed = i18nTextSchema.safeParse(optionLabel);
        if (typeof value !== "string" || value === "" || !parsed.success) continue;
        options.push({ value, label: text(parsed.data, locale, fallback).text });
      }
      // Výběr bez použitelné možnosti nejde zobrazit ani vyplnit.
      if (options.length === 0) continue;
    }
    result.push({
      key: question.key,
      type: question.type,
      label: label.text,
      labelLang: label.lang,
      options,
      required: question.required,
      eventId: question.event_id,
    });
  }
  return result;
}

function stringifyAnswer(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "yes" : "no";
  return null;
}

/** Model pro domácnost z lístku (`rsvp_get`), včetně předvyplnění dřívější odpovědí. */
export function buildListedModel(view: RsvpView, locale: Locale): RsvpFormModel {
  const source: Source = view;
  const flags = flagsOf(
    view.settings?.enabled_questions ?? {},
    view.settings?.email_confirmation ?? false,
  );
  const guests: FormGuest[] = view.guests.map((guest) => ({
    id: guest.id,
    name: guest.display_name,
    isChild: guest.is_child,
    age: guest.age,
    eventIds: view.invitations.filter((i) => i.guest_id === guest.id).map((i) => i.event_id),
  }));

  const values: FormValues = {
    attendance: {},
    diet: {},
    allergies: {},
    extras: [],
    answers: {},
    email: "",
  };
  const response = view.response;
  if (response) {
    for (const person of response.people) {
      if (person.guest_id) {
        const key = guestField(person.guest_id);
        for (const a of person.attendance) {
          values.attendance[attendanceField(key, a.event_id)] = a.attending ? "yes" : "no";
        }
        if (person.diet) values.diet[key] = person.diet;
        if (person.allergies) values.allergies[key] = person.allergies;
        if (person.has_health) values.savedHealth = { ...values.savedHealth, [key]: true };
      } else {
        values.extras.push({
          kind: person.is_child ? "child" : "adult",
          name: person.person_name,
          age: person.age === null ? "" : String(person.age),
          attendance: Object.fromEntries(
            person.attendance.map((a) => [a.event_id, a.attending ? "yes" : "no"] as const),
          ),
          diet: person.diet ?? "",
          allergies: person.allergies ?? "",
          ...(person.has_health ? { savedHealth: true, savedName: person.person_name } : {}),
        });
      }
    }
    for (const [key, value] of Object.entries(response.answers)) {
      const asText = stringifyAnswer(value);
      if (asText !== null) values.answers[key] = asText;
    }
    values.email = response.contact_email ?? "";
    if (response.has_email) values.savedEmail = true;
    if (response.has_updates) {
      values.savedUpdates = true;
      values.updates = true;
    }
  }

  return {
    mode: "listed",
    guests,
    events: eventsOf(source, locale),
    flags,
    questions: questionsOf(source, locale),
    values,
    existing: response !== null,
  };
}

/** Model pro hosta mimo seznam (`rsvp_unlisted_form`): bez hostů, první osoba je sám odpovídající. */
export function buildUnlistedModel(view: UnlistedFormView, locale: Locale): RsvpFormModel {
  const source: Source = view;
  return {
    mode: "unlisted",
    guests: [],
    events: eventsOf(source, locale),
    flags: flagsOf(view.settings.enabled_questions, view.settings.email_confirmation),
    questions: questionsOf(source, locale),
    values: {
      attendance: {},
      diet: {},
      allergies: {},
      extras: [{ kind: "adult", name: "", age: "", attendance: {}, diet: "", allergies: "" }],
      answers: {},
      email: "",
    },
    existing: false,
  };
}
