import { z } from "zod";
import { i18nTextSchema } from "./i18n-text";
import { phaseFromDates } from "./phase";
import { publicContentSchema, type PublicContent } from "./types";

/**
 * Koncept z pracovních tabulek (odpověď `get_public_site` pro roli `preview`) na obsah webu.
 * Pracovní tabulky nemají vše, co veřejný snímek (odkaz na mapu, média), proto jsou tyto
 * položky prázdné; ostatní se přenáší beze změny. Čistý modul.
 */

const iso = z.string();
const nullableText = i18nTextSchema.nullable().optional();

const previewSchema = z.object({
  mode: z.literal("preview"),
  wedding: z.object({
    default_locale: z.enum(["cs", "en"]),
    locales: z.array(z.enum(["cs", "en"])).min(1),
    template: z.string(),
    palette: z.string(),
    partner_a_name: z.string(),
    partner_b_name: z.string(),
    starts_on: z.string().nullable(),
    ends_on: z.string().nullable(),
    timezone: z.string(),
  }),
  pages: z.array(
    z.object({
      path: z.string(),
      blocks: z.array(
        z.object({
          id: z.string(),
          type: z.string(),
          anchor: z.string(),
          sensitive: z.boolean(),
          data: z.unknown(),
        }),
      ),
    }),
  ),
  events: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["ceremony", "reception", "other"]),
      title: i18nTextSchema,
      description: nullableText,
      starts_at: iso,
      ends_at: iso.nullable(),
      venue_id: z.string().nullable(),
    }),
  ),
  venues: z.array(
    z.object({
      id: z.string(),
      name: i18nTextSchema,
      directions: nullableText,
      address: z.string().nullable(),
    }),
  ),
});

/** `null`, když odpověď nemá očekávaný tvar nebo koncept není vykreslitelný (např. chybí datum). */
export function previewToPublicContent(
  raw: unknown,
  slug: string,
  now: Date = new Date(),
): PublicContent | null {
  const parsed = previewSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { wedding, pages, events, venues } = parsed.data;
  const home = pages.find((page) => page.path === "") ?? pages[0];
  if (!home || !wedding.starts_on) return null;

  const content = publicContentSchema.safeParse({
    version: 1,
    slug,
    partners: { a: wedding.partner_a_name, b: wedding.partner_b_name },
    startsOn: wedding.starts_on,
    endsOn: wedding.ends_on,
    timezone: wedding.timezone,
    locales: wedding.locales,
    defaultLocale: wedding.default_locale,
    template: wedding.template,
    palette: wedding.palette,
    phase: phaseFromDates({ startsOn: wedding.starts_on, endsOn: wedding.ends_on }, now),
    quickNotice: null,
    thanksMessage: null,
    venues: venues
      // Adresa soukromého místa se do náhledu nedostane (je jen po PINu).
      .filter((venue) => venue.address !== null)
      .map((venue) => ({
        id: venue.id,
        name: venue.name,
        address: venue.address,
        directions: venue.directions ?? null,
        mapUrl: null,
      })),
    events: events.map((event) => ({
      id: event.id,
      kind: event.kind,
      title: event.title,
      description: event.description ?? null,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      venueId: event.venue_id,
    })),
    media: [],
    // Dotaz vrací jen zapnuté bloky v pořadí; pozice se odvodí z pořadí.
    blocks: home.blocks.map((block, index) => ({
      ...block,
      enabled: true,
      position: index + 1,
    })),
  });
  return content.success ? content.data : null;
}
