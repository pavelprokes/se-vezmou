import { locales } from "@/i18n/config";
import { z } from "zod";
import { i18nTextSchema } from "./i18n-text";
import { phaseFromDates } from "./phase";
import { dayInZone } from "./format";
import { blockSchema, publicContentSchema, type PublicContent } from "./types";

/**
 * Koncept z pracovních tabulek (odpověď `get_public_site` pro roli `preview`) na obsah webu.
 * Pracovní tabulky nemají vše, co veřejný snímek (média), proto je tato položka prázdná;
 * ostatní se přenáší beze změny. Čistý modul.
 */

const iso = z.string();
const nullableText = i18nTextSchema.nullable().optional();

const previewSchema = z.object({
  mode: z.literal("preview"),
  wedding: z.object({
    default_locale: z.enum(locales),
    locales: z.array(z.enum(locales)).min(1),
    template: z.string(),
    palette: z.string(),
    partner_a_name: z.string(),
    partner_b_name: z.string(),
    starts_on: z.string().nullable(),
    ends_on: z.string().nullable(),
    timezone: z.string(),
    /** Konec potvrzování účasti (fáze náhledu); starší odpověď ho nemá. */
    rsvp_closes_at: z.string().nullable().optional(),
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
      /** Odkaz na mapu veřejného místa (M7a); starší odpověď ho nemá. */
      map_url: z.string().nullable().optional(),
      /** Souřadnice pro mapu; starší odpověď je nemá. */
      lat: z.number().nullable().optional(),
      lng: z.number().nullable().optional(),
    }),
  ),
});

/**
 * Blok pracovní kopie pro náhled: chráněný odkaz na galerii nemá ve veřejném snímku adresu ani kartu (ukazuje se
 * až po PINu), pracovní kopie je ale drží; bez úpravy by blok neprošel schématem.
 */
function previewBlock(block: Record<string, unknown>): Record<string, unknown> {
  if (block.type !== "gallery" || typeof block.data !== "object" || block.data === null)
    return block;
  const data = block.data as Record<string, unknown>;
  const link = data.link as Record<string, unknown> | null | undefined;
  if (!link || link.protected !== true) return block;
  return { ...block, data: { ...data, link: { ...link, url: null, card: null } } };
}

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
    // Fáze v časovém pásmu svatby a s termínem potvrzení účasti (jako zveřejněný web).
    phase: phaseFromDates(
      {
        startsOn: wedding.starts_on,
        endsOn: wedding.ends_on,
        deadline: wedding.rsvp_closes_at
          ? dayInZone(wedding.rsvp_closes_at, wedding.timezone)
          : null,
      },
      now,
      wedding.timezone,
    ),
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
        mapUrl: venue.map_url ?? null,
        lat: venue.lat ?? null,
        lng: venue.lng ?? null,
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
    // Dotaz vrací jen zapnuté bloky v pořadí; pozice se odvodí z pořadí. Pracovní kopie není normalizovaná
    // jako zveřejněný snímek: blok, který neprojde schématem, se vynechá (dřív shodil celý náhled na 404).
    blocks: home.blocks.flatMap((block, index) => {
      const parsed = blockSchema.safeParse(
        previewBlock({ ...block, enabled: true, position: index + 1 }),
      );
      return parsed.success ? [parsed.data] : [];
    }),
  });
  return content.success ? content.data : null;
}
