import { publicContentSchema, sensitiveContentSchema } from "../types";

/**
 * Ukázkové weby vymyšleného páru Klára a Matěj (nikdy skutečný pár). Slouží vývojovému náhledu
 * a testům; produkční data přijdou z databáze (TODO(M5), `getPublicContent` v `../content.ts`).
 * Fixtury se při načtení ověřují zod schématem, takže drift typu se pozná hned.
 */

const media = [
  {
    id: "m1",
    src: "/fixtures/zahrada.svg",
    width: 1200,
    height: 800,
    alt: {
      cs: "Ilustrace zahrady s eukalyptovými větvemi",
      en: "Illustration of a garden with eucalyptus branches",
    },
    decorative: false,
  },
  {
    id: "m2",
    src: "/fixtures/zamek.svg",
    width: 1200,
    height: 800,
    alt: { cs: "Ilustrace zámku při západu slunce", en: "Illustration of a chateau at sunset" },
    decorative: false,
  },
  {
    id: "m3",
    src: "/fixtures/stul.svg",
    width: 1200,
    height: 800,
    alt: null,
    decorative: true,
  },
];

const venues = [
  {
    id: "v1",
    name: { cs: "Zámecká kaple", en: "Castle chapel" },
    address: "Zámecká 1, 252 01 Dobřichovice",
    directions: {
      cs: "Parkovat se dá na nádvoří zámku. Z nádraží je to deset minut pěšky.",
      en: "Parking is available in the castle courtyard. It is a ten minute walk from the station.",
    },
    mapUrl: "https://www.openstreetmap.org/search?query=Dob%C5%99ichovice%20z%C3%A1mek",
    lat: 49.92556,
    lng: 14.27639,
  },
  {
    id: "v2",
    name: { cs: "Zámecká zahrada", en: "Castle garden" },
    address: "Zámecká 1, 252 01 Dobřichovice",
    directions: null,
    mapUrl: null,
    lat: 49.92556,
    lng: 14.27639,
  },
  {
    // Soukromé místo: adresa je jen za PINem hostů (`sensitiveRaw.venues`), ne ve snímku.
    id: "v3",
    name: { cs: "Soukromý altán", en: "Private gazebo" },
    address: null,
    isPrivate: true,
    directions: null,
    mapUrl: null,
  },
];

const events = [
  {
    id: "e1",
    kind: "ceremony" as const,
    title: { cs: "Svatební obřad", en: "Wedding ceremony" },
    description: {
      cs: "Prosíme, přijďte o čtvrt hodiny dřív.",
      en: "Please arrive fifteen minutes early.",
    },
    startsAt: "2027-06-19T14:00:00+02:00",
    endsAt: "2027-06-19T14:45:00+02:00",
    venueId: "v1",
  },
  {
    id: "e2",
    kind: "reception" as const,
    title: { cs: "Přípitek a občerstvení", en: "Toast and refreshments" },
    description: null,
    startsAt: "2027-06-19T15:00:00+02:00",
    endsAt: null,
    venueId: "v2",
  },
  {
    id: "e3",
    kind: "reception" as const,
    title: { cs: "Svatební hostina", en: "Wedding dinner" },
    description: {
      cs: "Menu zahrnuje i vegetariánskou variantu.",
      en: "The menu includes a vegetarian option.",
    },
    startsAt: "2027-06-19T17:30:00+02:00",
    endsAt: null,
    venueId: "v2",
  },
  {
    id: "e4",
    kind: "other" as const,
    title: { cs: "První tanec a zábava", en: "First dance and party" },
    description: null,
    startsAt: "2027-06-19T20:00:00+02:00",
    endsAt: "2027-06-20T01:00:00+02:00",
    venueId: "v2",
  },
];

const eukalyptusRaw = {
  version: 1,
  slug: "klara-a-matej",
  partners: { a: "Klára", b: "Matěj" },
  startsOn: "2027-06-19",
  endsOn: null,
  timezone: "Europe/Prague",
  locales: ["cs", "en"],
  defaultLocale: "cs",
  template: "eukalyptus",
  palette: "stribrna",
  phase: "rsvp_open",
  quickNotice: {
    cs: "Obřad začíná v 14:00. Prosíme, přijďte s předstihem.",
    en: "The ceremony starts at 14:00. Please arrive a little early.",
  },
  thanksMessage: null,
  venues,
  events,
  media,
  blocks: [
    {
      id: "b1",
      type: "hero",
      anchor: "uvod",
      enabled: true,
      position: 1,
      sensitive: false,
      data: { countdown: true, tagline: null },
    },
    {
      id: "b2",
      type: "story",
      anchor: "pribeh",
      enabled: true,
      position: 2,
      sensitive: false,
      data: {
        text: {
          cs: "Potkali jsme se v zimě na horské chatě, kde nám vypadl proud. Od té doby spolu zapalujeme svíčky a sbíráme eukalyptové větve.\n\nMatěj žádal o ruku na podzimní procházce lesem. Klára řekla ano dřív, než stihl doříct otázku.",
          en: "We met one winter at a mountain cabin when the power went out. Ever since, we have been lighting candles and collecting eucalyptus branches together.\n\nMatěj proposed on an autumn walk in the woods. Klára said yes before he finished the question.",
        },
        mediaId: "m1",
      },
    },
    {
      id: "b3",
      type: "program",
      anchor: "program",
      enabled: true,
      position: 3,
      sensitive: false,
      data: { intro: null },
    },
    {
      id: "b4",
      type: "venue",
      anchor: "misto",
      enabled: true,
      position: 4,
      sensitive: false,
      data: { venueIds: ["v1", "v2", "v3"], intro: null, showMap: true },
    },
    {
      id: "b5",
      type: "lodging",
      anchor: "ubytovani",
      enabled: true,
      position: 5,
      sensitive: false,
      data: {
        items: [
          {
            id: "l1",
            name: { cs: "Penzion U Řeky", en: "River Guesthouse" },
            description: {
              cs: "Dvacet pokojů, snídaně v ceně. Při rezervaci uveďte heslo Klára a Matěj.",
              en: "Twenty rooms, breakfast included. Mention Klára and Matěj when booking.",
            },
            url: "https://example.com/penzion",
          },
          {
            id: "l2",
            name: { cs: "Hotel Zámecký dvůr", en: "Castle Courtyard Hotel" },
            description: null,
            url: null,
          },
        ],
        transport: {
          cs: "Z Prahy jezdí vlak každou půlhodinu. Po obřadu pro hosty zajistíme večerní autobus zpět.",
          en: "Trains run from Prague every half hour. After the party we will arrange an evening bus back.",
        },
      },
    },
    {
      id: "b6",
      type: "dresscode",
      anchor: "dresscode",
      enabled: true,
      position: 6,
      sensitive: false,
      data: {
        text: {
          cs: "Společenské oblečení v zemitých a zelených tónech. Prosíme, vyhněte se bílé a smetanové barvě.",
          en: "Formal attire in earthy and green tones. Please avoid white and cream.",
        },
      },
    },
    {
      id: "b7",
      type: "faq",
      anchor: "otazky",
      enabled: true,
      position: 7,
      sensitive: false,
      data: {
        items: [
          {
            id: "f1",
            question: { cs: "Mohu přijít s dětmi?", en: "Can I bring children?" },
            answer: {
              cs: "Samozřejmě. Pro děti bude připravený koutek s hrami a dětské menu.",
              en: "Of course. There will be a play corner and a children's menu.",
            },
          },
          {
            id: "f2",
            question: { cs: "Kde zaparkuji?", en: "Where can I park?" },
            answer: {
              cs: "Na nádvoří zámku je dvacet míst, další parkoviště je u nádraží.",
              en: "The castle courtyard has twenty spaces; more parking is at the station.",
            },
          },
          {
            id: "f3",
            question: { cs: "Do kdy potvrdit účast?", en: "When should I confirm?" },
            answer: { cs: "Nejpozději do konce dubna.", en: "By the end of April at the latest." },
          },
        ],
      },
    },
    {
      id: "b8",
      type: "gifts",
      anchor: "dary",
      enabled: true,
      position: 8,
      sensitive: true,
      data: {
        intro: {
          cs: "Největší radost nám uděláte svou přítomností. Chcete-li přispět na naši cestu, můžete použít účet níže.",
          en: "Your presence is the greatest gift. If you would like to contribute to our trip, you can use the account below.",
        },
      },
    },
    {
      id: "b9",
      type: "gallery",
      anchor: "galerie",
      enabled: true,
      position: 9,
      sensitive: false,
      data: { mediaIds: ["m1", "m2", "m3"] },
    },
    {
      id: "b10",
      type: "contact",
      anchor: "kontakt",
      enabled: true,
      position: 10,
      sensitive: false,
      data: {
        people: [
          {
            id: "c1",
            name: "Eva Nováková",
            role: { cs: "Svědkyně, dotazy k programu", en: "Maid of honour, programme questions" },
            email: "eva@example.com",
            phone: "+420 777 000 111",
          },
          {
            id: "c2",
            name: "Tomáš Dvořák",
            role: { cs: "Svědek, doprava a ubytování", en: "Best man, transport and stay" },
            email: null,
            phone: "+420 777 000 222",
          },
        ],
      },
    },
    {
      id: "b11",
      type: "rsvp",
      anchor: "potvrdit-ucast",
      enabled: true,
      position: 11,
      sensitive: false,
      data: {
        intro: {
          cs: "Dejte nám, prosím, vědět do konce dubna, zda přijdete.",
          en: "Please let us know by the end of April whether you can come.",
        },
      },
    },
  ],
};

/** Druhá ukázka: Editorial, méně bloků a několik textů jen česky (ověřuje náhradní jazyk). */
const editorialRaw = {
  ...eukalyptusRaw,
  template: "editorial",
  palette: "papir",
  phase: "save_the_date",
  quickNotice: null,
  media: media.slice(0, 2),
  venues: venues.slice(0, 1),
  events: events.slice(0, 2).map((event) => ({ ...event, venueId: "v1" })),
  blocks: [
    {
      id: "b1",
      type: "hero",
      anchor: "uvod",
      enabled: true,
      position: 1,
      sensitive: false,
      data: {
        countdown: true,
        tagline: { cs: "Zveme vás na naši svatbu", en: "You are invited to our wedding" },
      },
    },
    {
      id: "b3",
      type: "program",
      anchor: "program",
      enabled: true,
      position: 2,
      sensitive: false,
      data: { intro: { cs: "Den začíná před polednem a končí po půlnoci." } },
    },
    {
      id: "b4",
      type: "venue",
      anchor: "misto",
      enabled: true,
      position: 3,
      sensitive: false,
      data: { venueIds: ["v1"], intro: null },
    },
    {
      id: "b6",
      type: "dresscode",
      anchor: "dresscode",
      enabled: true,
      position: 4,
      sensitive: false,
      data: { text: { cs: "Společenské oblečení, bez dalších omezení." } },
    },
    {
      id: "b7",
      type: "faq",
      anchor: "otazky",
      enabled: true,
      position: 5,
      sensitive: false,
      data: {
        items: [
          {
            id: "f1",
            question: { cs: "Mohu přijít s dětmi?", en: "Can I bring children?" },
            answer: { cs: "Samozřejmě, děti jsou vítány." },
          },
        ],
      },
    },
    {
      id: "b8",
      type: "gifts",
      anchor: "dary",
      enabled: true,
      position: 6,
      sensitive: true,
      data: { intro: null },
    },
    {
      id: "b9",
      type: "gallery",
      anchor: "galerie",
      enabled: true,
      position: 7,
      sensitive: false,
      data: { mediaIds: ["m1", "m2"] },
    },
    {
      id: "b11",
      type: "rsvp",
      anchor: "potvrdit-ucast",
      enabled: true,
      position: 8,
      sensitive: false,
      data: { intro: null },
    },
  ],
};

const sensitiveRaw = {
  venues: {
    v3: {
      address: "Altánová 7, 252 01 Dobřichovice",
      directions: {
        cs: "Od zámku po zelené značce, zhruba dvacet minut.",
        en: "From the chateau along the green trail, about twenty minutes.",
      },
    },
  },
  gifts: {
    // Číslo účtu a IBAN z ukázky standardu, nepatří žádné osobě.
    account: "19-2000145399/0800",
    iban: "CZ6508000000192000145399",
    holder: "Klára Ukázková",
    bic: "GIBACZPX",
    paymentMessage: "Svatba Klára a Matěj",
  },
};

export const eukalyptusFixture = publicContentSchema.parse(eukalyptusRaw);
export const editorialFixture = publicContentSchema.parse(editorialRaw);
export const sensitiveFixture = sensitiveContentSchema.parse(sensitiveRaw);

export const fixtures = { eukalyptus: eukalyptusFixture, editorial: editorialFixture } as const;
export type FixtureKey = keyof typeof fixtures;
