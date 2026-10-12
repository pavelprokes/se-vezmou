/**
 * Obsah demo webu „Test a Test“ (viz docs/demo-web.md): ukázkový pár Klára a Matěj, česky i anglicky.
 * Čistý modul bez I/O (jen sharp pro vlastní vygenerované fotografie): skript scripts/demo-seed.mjs z něj
 * skládá volání existujících funkcí databáze. Všechna jména, kontakty a adresy jsou vymyšlené (e-maily
 * jen na vyhrazených doménách example.com a example.invalid, telefony ve tvaru 777 000 xxx, číslo účtu
 * z ukázky standardu), žádná skutečná osoba ani kontakt.
 */
import { createHash, randomInt } from "node:crypto";
import sharp from "sharp";
import {
  BLOCK_ANCHORS,
  editorDocSchema,
  type EditorBlock,
  type EditorDoc,
} from "../src/admin/site/doc";
import { pinProblem } from "../src/auth/pin-format";
import { PIN_LENGTH } from "../src/auth/config";
import { addDays, endOfDayIso, todayIn, zonedIso } from "../src/wizard/zoned";
import {
  buildLayout,
  seat,
  seatingPlanSchema,
  type SeatingPlan,
} from "../src/admin/seating/layout";

export const DEFAULT_SLUG = "test-a-test";
export const DEFAULT_TEMPLATE = "louka";
export const DEFAULT_PALETTE = "levandule";
export const PARTNERS = { a: "Klára", b: "Matěj" } as const;
export const BACKUP_EMAIL = "demo-zaloha@example.invalid";
export const SECOND_ADMIN_EMAIL = "demo-druhy-spravce@example.invalid";

/** Stabilní identifikátor odvozený od adresy webu a klíče: opakovaný běh ukládá stejné řádky (idempotence). */
export function demoId(slug: string, key: string): string {
  const h = createHash("sha1").update(`se-vezmou-demo:${slug}:${key}`).digest("hex");
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

// --- PIN ----------------------------------------------------------------------------------------

/** Náhodný šestimístný PIN bez zjevně triviálních hodnot (stejná pravidla jako aplikace). */
export function generatePin(random: (max: number) => number = (max) => randomInt(max)): string {
  for (let i = 0; i < 1000; i++) {
    const pin = String(random(10 ** PIN_LENGTH.min)).padStart(PIN_LENGTH.min, "0");
    if (pinProblem(pin) === null) return pin;
  }
  throw new Error("Nepodařilo se vygenerovat PIN");
}

// --- datum svatby -------------------------------------------------------------------------------

/** Nejméně tolik dní dopředu musí být datum svatby (jinak by se zavřelo RSVP a blížila by se retence). */
export const MIN_DAYS_AHEAD = 90;

function nextSaturday(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = neděle
  return addDays(date, (6 - day + 7) % 7);
}

/**
 * `auto` (výchozí): dnes + 1 rok, posunuto na sobotu. `+Ny` / `+Nm`: roky / měsíce od dneška (také na sobotu).
 * Jinak pevné datum `RRRR-MM-DD`. Datum blíž než MIN_DAYS_AHEAD dní se odmítne.
 */
export function resolveWeddingDate(spec: string | undefined, now = new Date()): string {
  const today = todayIn(now);
  const value = (spec ?? "auto").trim().toLowerCase();
  let date: string;
  const relative = /^\+(\d{1,2})([ym])$/.exec(value);
  if (value === "auto") {
    date = nextSaturday(shiftMonths(today, 12));
  } else if (relative) {
    const n = Number(relative[1]);
    date = nextSaturday(shiftMonths(today, relative[2] === "y" ? n * 12 : n));
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new Error(`Neplatné datum svatby: ${spec}`);
    }
    date = value;
  } else {
    throw new Error(`Datum svatby: použijte RRRR-MM-DD, +Ny, +Nm nebo auto (zadáno: ${spec})`);
  }
  if (date < addDays(today, MIN_DAYS_AHEAD)) {
    throw new Error(
      `Datum svatby ${date} je blíž než ${MIN_DAYS_AHEAD} dní od dneška. Demo musí mít svatbu hodně daleko, ` +
        "aby ho retenční úlohy nikdy neomezily (docs/demo-web.md).",
    );
  }
  return date;
}

function shiftMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

// --- fotografie ---------------------------------------------------------------------------------

export interface DemoPhoto {
  key: string;
  alt: { cs: string; en: string };
  svg: string;
}

function scene(
  sky: [string, string],
  hills: string[],
  extra: string,
  width = 1600,
  height = 1067,
): string {
  const [top, bottom] = sky;
  const layers = hills
    .map(
      (color, i) =>
        `<path d="M0 ${height * (0.6 + i * 0.1)} Q ${width * 0.3} ${height * (0.48 + i * 0.1)} ${width * 0.55} ${height * (0.6 + i * 0.1)} T ${width} ${height * (0.58 + i * 0.1)} V ${height} H0 Z" fill="${color}"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#s)"/>${extra}${layers}</svg>`;
}

/** Vlastní vygenerované ilustrace (žádné cizí fotografie ani autorská díla). */
export const DEMO_PHOTOS: readonly DemoPhoto[] = [
  {
    key: "louka",
    alt: {
      cs: "Ilustrace rozkvetlé louky při západu slunce",
      en: "Illustration of a flowering meadow at sunset",
    },
    svg: scene(
      ["#f6d7c3", "#e9e4f5"],
      ["#9aa876", "#7f9462", "#617a4f"],
      `<circle cx="1180" cy="430" r="120" fill="#fff3d6" opacity="0.9"/>`,
    ),
  },
  {
    key: "arch",
    alt: {
      cs: "Ilustrace svatebního oblouku ověšeného květinami",
      en: "Illustration of a wedding arch decorated with flowers",
    },
    svg: scene(
      ["#dfe8f5", "#f4efe6"],
      ["#a9b98c", "#86a06f"],
      `<path d="M560 800 V430 Q800 180 1040 430 V800" fill="none" stroke="#8a6f5a" stroke-width="22"/>` +
        [0, 1, 2, 3, 4, 5, 6]
          .map(
            (i) =>
              `<circle cx="${590 + i * 70}" cy="${400 - Math.sin(i / 2) * 120}" r="${26 + (i % 3) * 6}" fill="${["#c9a7e8", "#f2b8c6", "#fff", "#b79ad9"][i % 4]}"/>`,
          )
          .join(""),
    ),
  },
  {
    key: "stul",
    alt: {
      cs: "Ilustrace slavnostně prostřeného stolu se svíčkami",
      en: "Illustration of a festive table set with candles",
    },
    svg: scene(
      ["#2f2a45", "#4a3f6b"],
      ["#3b3356"],
      [0, 1, 2, 3, 4]
        .map(
          (i) =>
            `<rect x="${300 + i * 230}" y="560" width="26" height="130" fill="#f6efe0"/><ellipse cx="${313 + i * 230}" cy="540" rx="14" ry="26" fill="#ffd27a"/>`,
        )
        .join("") + `<rect x="160" y="700" width="1280" height="40" fill="#e8dfd0"/>`,
    ),
  },
  {
    key: "zamek",
    alt: {
      cs: "Ilustrace zámku na kopci za soumraku",
      en: "Illustration of a chateau on a hill at dusk",
    },
    svg: scene(
      ["#c7b9e6", "#f7d9c9"],
      ["#8d9a7a", "#6b7d5d"],
      `<rect x="640" y="380" width="320" height="260" fill="#efe6dc"/><rect x="600" y="320" width="70" height="320" fill="#e3d8cb"/><rect x="930" y="320" width="70" height="320" fill="#e3d8cb"/><path d="M590 320 L635 240 L680 320 Z" fill="#8c5e58"/><path d="M920 320 L965 240 L1010 320 Z" fill="#8c5e58"/>`,
    ),
  },
  {
    key: "prsteny",
    alt: {
      cs: "Ilustrace dvou propojených snubních prstenů",
      en: "Illustration of two interlocked wedding rings",
    },
    svg: scene(
      ["#f3eefa", "#efe3f1"],
      [],
      `<circle cx="720" cy="520" r="170" fill="none" stroke="#c9a14a" stroke-width="26"/><circle cx="880" cy="520" r="170" fill="none" stroke="#d8b867" stroke-width="26"/>`,
    ),
  },
  {
    key: "alej",
    alt: {
      cs: "Ilustrace stromořadí vedoucího k obřadnímu místu",
      en: "Illustration of an avenue of trees leading to the ceremony site",
    },
    svg: scene(
      ["#e4f0e0", "#f8f3e4"],
      ["#b4c796", "#8fae78"],
      [0, 1, 2, 3, 4]
        .map(
          (i) =>
            `<rect x="${230 + i * 60}" y="${520 - i * 16}" width="${22 - i * 2}" height="${200 - i * 16}" fill="#7a5f49"/><circle cx="${241 + i * 60}" cy="${470 - i * 16}" r="${80 - i * 9}" fill="#6f9460"/><rect x="${1330 - i * 60}" y="${520 - i * 16}" width="${22 - i * 2}" height="${200 - i * 16}" fill="#7a5f49"/><circle cx="${1341 - i * 60}" cy="${470 - i * 16}" r="${80 - i * 9}" fill="#6f9460"/>`,
        )
        .join(""),
    ),
  },
];

/** Bajty JPEG jedné ukázkové fotografie (běžný vstup pro zpracování, jako by ji nahrál pár). */
export async function renderPhoto(photo: DemoPhoto): Promise<Buffer> {
  return sharp(Buffer.from(photo.svg)).jpeg({ quality: 82 }).toBuffer();
}

// --- web ----------------------------------------------------------------------------------------

export interface DocOptions {
  slug: string;
  startsOn: string;
  template?: string;
  palette?: string;
  /** Identifikátory zpracovaných fotografií v pořadí `DEMO_PHOTOS`; bez nich galerie nese jen odkaz. */
  photoIds?: readonly string[];
}

const LAT = 49.9256;
const LNG = 14.2764;

export function buildDoc(options: DocOptions): EditorDoc {
  const { slug, startsOn } = options;
  const id = (key: string) => demoId(slug, key);
  const at = (day: number, time: string) => zonedIso(addDays(startsOn, day), time);
  const photos = options.photoIds ?? [];

  const events: EditorDoc["events"] = [
    {
      id: id("event-ceremony"),
      kind: "ceremony",
      title: { cs: "Svatební obřad", en: "Wedding ceremony" },
      description: {
        cs: "Prosíme, přijďte o čtvrt hodiny dřív. Obřad bude venku pod starými lipami.",
        en: "Please arrive fifteen minutes early. The ceremony takes place outdoors under the old lime trees.",
      },
      startsAt: at(0, "14:00"),
      endsAt: at(0, "14:45"),
      venueId: id("venue-ceremony"),
      rsvpEnabled: true,
    },
    {
      id: id("event-toast"),
      kind: "reception",
      title: { cs: "Přípitek a občerstvení", en: "Toast and refreshments" },
      description: {
        cs: "Domácí limonády, víno a lehké občerstvení na zahradě.",
        en: "Homemade lemonades, wine and light refreshments in the garden.",
      },
      startsAt: at(0, "15:00"),
      endsAt: null,
      venueId: id("venue-garden"),
      rsvpEnabled: false,
    },
    {
      id: id("event-dinner"),
      kind: "reception",
      title: { cs: "Svatební hostina", en: "Wedding dinner" },
      description: {
        cs: "Menu zahrnuje vegetariánskou i rybí variantu. Dětské menu je samozřejmostí.",
        en: "The menu includes vegetarian and fish options. A children's menu is available.",
      },
      startsAt: at(0, "17:30"),
      endsAt: null,
      venueId: id("venue-garden"),
      rsvpEnabled: true,
    },
    {
      id: id("event-party"),
      kind: "other",
      title: { cs: "První tanec a zábava", en: "First dance and party" },
      description: null,
      startsAt: at(0, "20:00"),
      endsAt: at(1, "01:00"),
      venueId: id("venue-garden"),
      rsvpEnabled: true,
    },
    {
      id: id("event-breakfast"),
      kind: "other",
      title: { cs: "Společná snídaně", en: "Farewell breakfast" },
      description: {
        cs: "Tichá snídaně v altánu pro ty, kdo zůstanou přes noc.",
        en: "A relaxed breakfast in the gazebo for those staying overnight.",
      },
      startsAt: at(1, "09:30"),
      endsAt: null,
      venueId: id("venue-gazebo"),
      rsvpEnabled: false,
    },
  ];

  const venues: EditorDoc["venues"] = [
    {
      id: id("venue-ceremony"),
      name: { cs: "Zámecká kaple a lipový dvůr", en: "Castle chapel and linden courtyard" },
      address: "Zámecká 1, 252 01 Dobřichovice",
      isPrivate: false,
      directions: {
        cs: "Parkovat se dá na nádvoří zámku. Z nádraží je to deset minut pěšky.",
        en: "Parking is available in the castle courtyard. It is a ten minute walk from the station.",
      },
      mapUrl: null,
      lat: LAT,
      lng: LNG,
    },
    {
      id: id("venue-garden"),
      name: { cs: "Zámecká zahrada a sál", en: "Castle garden and hall" },
      address: "Zámecká 1, 252 01 Dobřichovice",
      isPrivate: false,
      directions: null,
      mapUrl: null,
      lat: LAT + 0.0008,
      lng: LNG + 0.0012,
    },
    {
      // Soukromé místo: adresa je jen za PINem hostů.
      id: id("venue-gazebo"),
      name: { cs: "Soukromý altán", en: "Private gazebo" },
      address: "Altánová 7, 252 01 Dobřichovice",
      isPrivate: true,
      directions: {
        cs: "Od zámku po zelené značce, zhruba dvacet minut pěšky.",
        en: "From the chateau along the green trail, about twenty minutes on foot.",
      },
      mapUrl: null,
      lat: null,
      lng: null,
    },
  ];

  const blocks: EditorBlock[] = [
    {
      id: id("block-hero"),
      type: "hero",
      anchor: BLOCK_ANCHORS.hero,
      enabled: true,
      position: 0,
      sensitive: false,
      data: {
        countdown: true,
        tagline: {
          cs: "Budeme se brát. Přijďte slavit s námi.",
          en: "We are getting married. Come celebrate with us.",
        },
        photoMediaId: photos[0] ?? null,
      },
    },
    {
      id: id("block-story"),
      type: "story",
      anchor: BLOCK_ANCHORS.story,
      enabled: true,
      position: 1,
      sensitive: false,
      data: {
        text: {
          cs: "Potkali jsme se v zimě na horské chatě, kde nám vypadl proud. Od té doby spolu zapalujeme svíčky a sbíráme luční květiny na zimní věnce.\n\nMatěj žádal o ruku na podzimní procházce lesem. Klára řekla ano dřív, než stihl doříct otázku.",
          en: "We met one winter at a mountain cabin when the power went out. Ever since, we have been lighting candles and collecting wild flowers for winter wreaths together.\n\nMatěj proposed on an autumn walk in the woods. Klára said yes before he finished the question.",
        },
        mediaId: photos[1] ?? null,
      },
    },
    {
      id: id("block-program"),
      type: "program",
      anchor: BLOCK_ANCHORS.program,
      enabled: true,
      position: 2,
      sensitive: false,
      data: {
        intro: {
          cs: "Celý den se odehraje na jednom místě, takže nikam nemusíte přejíždět.",
          en: "The whole day takes place in one location, so there is no need to travel between venues.",
        },
      },
    },
    {
      id: id("block-venue"),
      type: "venue",
      anchor: BLOCK_ANCHORS.venue,
      enabled: true,
      position: 3,
      sensitive: false,
      data: {
        venueIds: [id("venue-ceremony"), id("venue-garden"), id("venue-gazebo")],
        intro: null,
        showMap: true,
      },
    },
    {
      id: id("block-lodging"),
      type: "lodging",
      anchor: BLOCK_ANCHORS.lodging,
      enabled: true,
      position: 4,
      sensitive: false,
      data: {
        items: [
          {
            id: id("lodging-river"),
            name: { cs: "Penzion U Řeky", en: "River Guesthouse" },
            description: {
              cs: "Dvacet pokojů, snídaně v ceně. Při rezervaci uveďte heslo „Klára a Matěj“.",
              en: "Twenty rooms, breakfast included. Mention “Klára and Matěj” when booking.",
            },
            url: "https://example.com/penzion-u-reky",
            address: "Říční 12, 252 01 Dobřichovice",
            showOnMap: true,
            lat: LAT - 0.0021,
            lng: LNG - 0.0016,
          },
          {
            id: id("lodging-courtyard"),
            name: { cs: "Hotel Zámecký dvůr", en: "Castle Courtyard Hotel" },
            description: {
              cs: "Pár kroků od místa obřadu, pokoje s výhledem do parku.",
              en: "A few steps from the ceremony site, rooms overlooking the park.",
            },
            url: "https://example.com/hotel-zamecky-dvur",
            address: "Zámecká 3, 252 01 Dobřichovice",
            showOnMap: true,
            lat: LAT + 0.0004,
            lng: LNG - 0.0006,
          },
          {
            id: id("lodging-farm"),
            name: { cs: "Statek Pod lipou", en: "Under the Linden Farm" },
            description: null,
            url: null,
            address: null,
            showOnMap: false,
            lat: null,
            lng: null,
          },
        ],
        transport: {
          cs: "Z Prahy jezdí vlak každou půlhodinu, cesta trvá dvacet minut. Po zábavě pro hosty zajistíme večerní autobus zpět do Prahy.",
          en: "Trains run from Prague every half hour, the journey takes twenty minutes. After the party we will arrange an evening bus back to Prague.",
        },
      },
    },
    {
      id: id("block-dresscode"),
      type: "dresscode",
      anchor: BLOCK_ANCHORS.dresscode,
      enabled: true,
      position: 5,
      sensitive: false,
      data: {
        text: {
          cs: "Společenské oblečení v pastelových a zemitých tónech, klidně s kouskem levandulové. Prosíme, vyhněte se bílé a smetanové barvě. Obřad je venku, na trávě se hodí nižší podpatek.",
          en: "Formal attire in pastel and earthy tones, a touch of lavender is welcome. Please avoid white and cream. The ceremony is outdoors, so lower heels work best on the grass.",
        },
      },
    },
    {
      id: id("block-faq"),
      type: "faq",
      anchor: BLOCK_ANCHORS.faq,
      enabled: true,
      position: 6,
      sensitive: false,
      data: {
        items: [
          {
            id: id("faq-children"),
            question: { cs: "Mohu přijít s dětmi?", en: "Can I bring children?" },
            answer: {
              cs: "Samozřejmě. Pro děti bude připravený koutek s hrami, hlídání a dětské menu.",
              en: "Of course. There will be a play corner, childcare and a children's menu.",
            },
          },
          {
            id: id("faq-parking"),
            question: { cs: "Kde zaparkuji?", en: "Where can I park?" },
            answer: {
              cs: "Na nádvoří zámku je dvacet míst, další parkoviště je u nádraží.",
              en: "The castle courtyard has twenty spaces; more parking is at the station.",
            },
          },
          {
            id: id("faq-deadline"),
            question: { cs: "Do kdy potvrdit účast?", en: "When should I confirm?" },
            answer: {
              cs: "Nejpozději měsíc před svatbou. Odpověď můžete kdykoli změnit z osobního odkazu.",
              en: "No later than one month before the wedding. You can change your answer any time from your personal link.",
            },
          },
          {
            id: id("faq-photos"),
            question: {
              cs: "Smím fotit během obřadu?",
              en: "May I take photos during the ceremony?",
            },
            answer: {
              cs: "Obřad nám zachytí fotograf, prosíme o telefony v kapse. Po obřadu se vyfotit můžete, co hrdlo ráčí.",
              en: "A photographer will capture the ceremony, so please keep phones in your pockets. Afterwards, snap away.",
            },
          },
          {
            id: id("faq-gifts"),
            question: {
              cs: "Jaký dárek nám uděláte radost?",
              en: "What gift would make us happy?",
            },
            answer: {
              cs: "Nejvíc nás potěší vaše přítomnost. V sekci Dary najdete příspěvek na cestu i seznam věcí, které se nám hodí.",
              en: "Your presence is the best gift. The Gifts section has a contribution to our trip and a list of things we could use.",
            },
          },
        ],
      },
    },
    {
      id: id("block-gifts"),
      type: "gifts",
      anchor: BLOCK_ANCHORS.gifts,
      enabled: true,
      position: 7,
      sensitive: true,
      data: {
        intro: {
          cs: "Největší radost nám uděláte svou přítomností. Chcete-li přispět na naši svatební cestu, můžete použít účet níže nebo si rezervovat věc ze seznamu.",
          en: "Your presence is the greatest gift. If you would like to contribute to our honeymoon, you can use the account below or reserve an item from the list.",
        },
        // Číslo účtu z ukázky standardu, nepatří žádné osobě.
        account: "19-2000145399/0800",
        holder: "Klára Ukázková",
        bic: "GIBACZPX",
        paymentMessage: "Svatba Klára a Matěj",
      },
    },
    {
      id: id("block-gallery"),
      type: "gallery",
      anchor: BLOCK_ANCHORS.gallery,
      enabled: true,
      position: 8,
      sensitive: false,
      data: {
        mediaIds: photos.slice(2),
        photosProtected: false,
        link: {
          url: "https://example.com/galerie-test-a-test",
          label: { cs: "Svatební galerie fotografa", en: "Photographer’s wedding gallery" },
          protected: false,
          card: null,
        },
      },
    },
    {
      id: id("block-contact"),
      type: "contact",
      anchor: BLOCK_ANCHORS.contact,
      enabled: true,
      position: 9,
      sensitive: false,
      data: {
        people: [
          {
            id: id("contact-eva"),
            name: "Eva Svobodová",
            role: { cs: "Svědkyně, dotazy k programu", en: "Maid of honour, programme questions" },
            email: "eva@example.com",
            phone: "+420 777 000 111",
          },
          {
            id: id("contact-tomas"),
            name: "Tomáš Černý",
            role: {
              cs: "Svědek, doprava a ubytování",
              en: "Best man, transport and accommodation",
            },
            email: null,
            phone: "+420 777 000 222",
          },
        ],
      },
    },
    {
      id: id("block-rsvp"),
      type: "rsvp",
      anchor: BLOCK_ANCHORS.rsvp,
      enabled: true,
      position: 10,
      sensitive: false,
      data: {
        intro: {
          cs: "Dejte nám, prosím, vědět nejpozději měsíc před svatbou, zda přijdete. Stačí vyplnit jméno nebo otevřít osobní odkaz z pozvánky.",
          en: "Please let us know no later than one month before the wedding whether you can come. Just enter your name or open the personal link from your invitation.",
        },
      },
    },
  ];

  return editorDocSchema.parse({
    wedding: {
      partnerA: PARTNERS.a,
      partnerB: PARTNERS.b,
      startsOn,
      endsOn: null,
      timezone: "Europe/Prague",
      locales: ["cs", "en"],
      defaultLocale: "cs",
      template: options.template ?? DEFAULT_TEMPLATE,
      palette: options.palette ?? DEFAULT_PALETTE,
    },
    venues,
    events,
    blocks,
  });
}

export const QUICK_NOTICE = {
  cs: "Toto je ukázkový web. Všechna jména, termíny a kontakty jsou vymyšlené.",
  en: "This is a demo site. All names, dates and contacts are fictional.",
};

// --- nastavení RSVP -----------------------------------------------------------------------------

export function buildRsvpSettings(slug: string, startsOn: string) {
  const id = (key: string) => demoId(slug, key);
  return {
    opens_at: null,
    // uzávěrka měsíc před svatbou, celý den
    closes_at: endOfDayIso(addDays(startsOn, -30)),
    allow_unlisted: true,
    email_confirmation: true,
    enabled_questions: {
      plus_one: true,
      children: true,
      diet: true,
      lodging: true,
      transport: true,
      song: true,
      message: true,
      updates: true,
    },
    questions: [
      {
        key: "menu",
        type: "choice",
        label: { cs: "Které hlavní jídlo si dáte?", en: "Which main course would you like?" },
        options: [
          {
            value: "meat",
            label: { cs: "Svíčková na smetaně", en: "Beef sirloin in cream sauce" },
          },
          { value: "fish", label: { cs: "Pečený pstruh", en: "Baked trout" } },
          {
            value: "vege",
            label: { cs: "Houbové rizoto (vegetariánské)", en: "Mushroom risotto (vegetarian)" },
          },
        ],
        required: true,
        event_id: id("event-dinner"),
        enabled: true,
      },
      {
        key: "afterparty",
        type: "bool",
        label: {
          cs: "Zůstanete na zábavu do rána?",
          en: "Will you stay for the party until morning?",
        },
        required: false,
        event_id: id("event-party"),
        enabled: true,
      },
    ],
  };
}

// --- hosté a odpovědi ---------------------------------------------------------------------------

type EventKey = "ceremony" | "dinner" | "party";

export interface DemoPerson {
  name: string;
  child?: boolean;
  age?: number;
  /** Diety a alergie (zdravotní údaje, mažou se 30 dní po svatbě). */
  diet?: string;
  attends?: Partial<Record<EventKey, boolean>>;
}

export interface DemoHousehold {
  key: string;
  label: string;
  note?: string;
  tags: string[];
  /** Události, na které je domácnost pozvaná. */
  events: EventKey[];
  people: DemoPerson[];
  /** Odpověď domácnosti; bez ní zůstane stav „bez odpovědi“. */
  response?: {
    answers: Record<string, string | boolean>;
    plusOne?: { name: string; attends: Partial<Record<EventKey, boolean>> };
    extraChild?: { name: string; age: number; attends: Partial<Record<EventKey, boolean>> };
  };
}

const ALL: EventKey[] = ["ceremony", "dinner", "party"];
const YES = { ceremony: true, dinner: true, party: true } as const;

export const DEMO_HOUSEHOLDS: readonly DemoHousehold[] = [
  {
    key: "novakovi",
    label: "Novákovi",
    tags: ["Rodina nevěsty"],
    events: ALL,
    people: [
      { name: "Jana Nováková", attends: YES },
      { name: "Petr Novák", attends: YES },
      { name: "Anežka Nováková", child: true, age: 9, diet: "Bez lepku", attends: YES },
    ],
    response: {
      answers: {
        menu: "meat",
        afterparty: true,
        lodging: "own",
        transport: "own",
        song: "Hana Hegerová – Pár havranů",
        message: "Moc se na vás těšíme, bude to nádherný den!",
      },
    },
  },
  {
    key: "dvorakovi",
    label: "Dvořákovi",
    tags: ["Rodina ženicha"],
    events: ALL,
    people: [
      { name: "Marie Dvořáková", attends: { ceremony: true, dinner: true, party: false } },
      { name: "Josef Dvořák", attends: { ceremony: true, dinner: true, party: false } },
    ],
    response: { answers: { menu: "fish", afterparty: false, lodging: "need", transport: "offer" } },
  },
  {
    key: "svobodova",
    label: "Eva Svobodová",
    note: "Svědkyně",
    tags: ["Přátelé", "Svědci"],
    events: ALL,
    people: [{ name: "Eva Svobodová", attends: YES }],
    response: {
      answers: { menu: "vege", afterparty: true, lodging: "need", transport: "own" },
      plusOne: { name: "Lukáš Veselý", attends: YES },
    },
  },
  {
    key: "cerny",
    label: "Tomáš Černý",
    note: "Svědek",
    tags: ["Přátelé", "Svědci"],
    events: ALL,
    people: [{ name: "Tomáš Černý", attends: YES }],
    response: {
      answers: {
        menu: "meat",
        afterparty: true,
        lodging: "unsure",
        transport: "offer",
        song: "Queen – Don't Stop Me Now",
      },
    },
  },
  {
    key: "krejci",
    label: "Krejčí",
    tags: ["Přátelé"],
    events: ALL,
    people: [
      { name: "Lucie Krejčí", attends: { ceremony: true, dinner: true, party: false } },
      { name: "Martin Krejčí", attends: { ceremony: true, dinner: true, party: false } },
      {
        name: "Šimon Krejčí",
        child: true,
        age: 4,
        attends: { ceremony: true, dinner: true, party: false },
      },
    ],
    response: {
      answers: { menu: "meat", afterparty: false, lodging: "own", transport: "own" },
      extraChild: {
        name: "Sofie Krejčí",
        age: 1,
        attends: { ceremony: true, dinner: false, party: false },
      },
    },
  },
  {
    key: "smithovi",
    label: "Smithovi",
    note: "Přátelé z Londýna, anglicky",
    tags: ["Zahraniční hosté"],
    events: ALL,
    people: [
      { name: "Emily Smith", diet: "Vegetarian, no nuts", attends: YES },
      { name: "James Smith", diet: "Vegetarian", attends: YES },
    ],
    response: {
      answers: {
        menu: "vege",
        afterparty: true,
        lodging: "need",
        transport: "need",
        message: "Congratulations to you both! We have booked our flights already.",
      },
    },
  },
  {
    key: "vesela",
    label: "Babička Božena Veselá",
    tags: ["Rodina nevěsty"],
    events: ["ceremony", "dinner"],
    people: [
      {
        name: "Božena Veselá",
        diet: "Bez soli, diabetická dieta",
        attends: { ceremony: true, dinner: true },
      },
    ],
    response: { answers: { menu: "fish", lodging: "own", transport: "need" } },
  },
  {
    key: "prochazka",
    label: "Strýc Karel Procházka",
    tags: ["Rodina ženicha"],
    events: ALL,
    people: [
      { name: "Karel Procházka", attends: { ceremony: false, dinner: false, party: false } },
    ],
    response: { answers: { message: "Bohužel nemohu, budu na služební cestě. Všechno nejlepší!" } },
  },
  {
    key: "markovi",
    label: "Marková a Marek",
    tags: ["Přátelé"],
    events: ALL,
    people: [{ name: "Tereza Marková" }, { name: "Filip Marek" }],
  },
  {
    key: "kolegove",
    label: "Kolegové z práce",
    tags: ["Kolegové"],
    events: ["ceremony", "dinner", "party"],
    people: [{ name: "Barbora Králová" }, { name: "Ondřej Kral" }, { name: "Radka Šimková" }],
  },
  {
    key: "horakovi",
    label: "Sousedé Horákovi",
    tags: ["Sousedé"],
    events: ["ceremony", "dinner"],
    people: [{ name: "Alena Horáková" }, { name: "Zdeněk Horák" }],
  },
  {
    key: "benes",
    label: "Adam Beneš",
    tags: ["Přátelé"],
    events: ALL,
    people: [{ name: "Adam Beneš" }],
  },
];

// --- dary, dodavatelé, poznámky -----------------------------------------------------------------

export const DEMO_GIFTS = [
  {
    key: "kavovar",
    title: { cs: "Pákový kávovar", en: "Espresso machine" },
    description: { cs: "Ranní káva je u nás svátek.", en: "Morning coffee is a ritual for us." },
    url: "https://example.com/darky/kavovar",
    price: "9 990 Kč",
    reservedBy: "Eva S.",
  },
  {
    key: "povleceni",
    title: { cs: "Lněné povlečení", en: "Linen bedding set" },
    description: { cs: "Světle šedé nebo levandulové.", en: "Light grey or lavender." },
    url: "https://example.com/darky/povleceni",
    price: "2 490 Kč",
    reservedBy: null,
  },
  {
    key: "piknik",
    title: { cs: "Piknikový košík", en: "Picnic basket" },
    description: null,
    url: "https://example.com/darky/piknik",
    price: "1 590 Kč",
    reservedBy: null,
  },
  {
    key: "nastenka",
    title: { cs: "Fotoalbum na naše fotky", en: "Photo album for our pictures" },
    description: null,
    url: null,
    price: "790 Kč",
    reservedBy: null,
  },
  {
    key: "hrnce",
    title: { cs: "Sada litinových hrnců", en: "Cast iron pot set" },
    description: { cs: "Rádi vaříme společně.", en: "We love cooking together." },
    url: "https://example.com/darky/hrnce",
    price: "4 200 Kč",
    reservedBy: null,
  },
  {
    key: "poukaz",
    title: { cs: "Poukaz na společný kurz vaření", en: "Voucher for a cooking class for two" },
    description: null,
    url: null,
    price: null,
    reservedBy: "",
  },
] as const;

export const DEMO_VENDORS = [
  {
    key: "foto",
    category: "photo",
    name: "Ukázkové foto studio",
    contact: "Anna Ukázková, +420 777 000 301",
    url: "https://example.com/foto",
    price: "18 000 Kč",
    status: "booked",
    note: "Záloha zaplacena, focení od 12:00 do půlnoci.",
  },
  {
    key: "kvetiny",
    category: "flowers",
    name: "Květinářství Pod lipou",
    contact: "kvetiny@example.com",
    url: "https://example.com/kvetiny",
    price: "7 500 Kč",
    status: "booked",
    note: "Levandule a sušené trávy, oblouk i kytice.",
  },
  {
    key: "hudba",
    category: "music",
    name: "Kapela Zlatý vítr",
    contact: "+420 777 000 302",
    url: null,
    price: "22 000 Kč",
    status: "contacted",
    note: "Čekáme na nabídku, požadavek: první tanec živě.",
  },
  {
    key: "catering",
    category: "catering",
    name: "Catering U Zlaté lžíce",
    contact: "objednavky@example.com",
    url: "https://example.com/catering",
    price: "650 Kč / osoba",
    status: "booked",
    note: "Ochutnávka proběhla, menu: svíčková, pstruh, houbové rizoto.",
  },
  {
    key: "dort",
    category: "cake",
    name: "Cukrárna Sladký sen",
    contact: null,
    url: null,
    price: null,
    status: "idea",
    note: "Třípatrový dort s fialkami, rozhodnout do konce léta.",
  },
  {
    key: "autobus",
    category: "transport",
    name: "Autobusová doprava Rychlík",
    contact: "+420 777 000 303",
    url: null,
    price: "6 800 Kč",
    status: "contacted",
    note: "Večerní spoj zpět do Prahy, 40 míst.",
  },
] as const;

export const DEMO_NOTES =
  "Úkoly před svatbou\n" +
  "- potvrdit počty hostů s cateringem měsíc předem\n" +
  "- rozeslat osobní odkazy z přehledu hostů\n" +
  "- vytisknout jmenovky a zasedací pořádek\n" +
  "- domluvit zkoušku obřadu se svědky\n\n" +
  "Nápady na hudbu\n" +
  "- vstup: klavírní verze oblíbené písničky\n" +
  "- první tanec: vybereme po ochutnávce\n\n" +
  "(Ukázková poznámka. Poznámky vidí jen správci webu, hosté nikdy.)";

// --- zasedací pořádek ---------------------------------------------------------------------------

/** Prázdný plán se šesti kulatými stoly po osmi místech, navázaný na událost hostiny. */
export function buildSeatingBase(dinnerEventId: string): SeatingPlan {
  const layout = buildLayout("round", { tables: 6, seats: 8 });
  return seatingPlanSchema.parse({
    version: 1,
    preset: layout.preset,
    params: layout.params,
    eventId: dinnerEventId,
    tables: layout.tables,
    width: layout.width,
    height: layout.height,
    assignments: {},
  });
}

/**
 * Usadí osoby po domácnostech (domácnost vedle sebe) ke stolům v pořadí; `groups` jsou klíče osob
 * po domácnostech, které potvrdily hostinu. Rodiny a přátelé se rozdělí na dva stoly, ostatní do dalších.
 */
export function seatHouseholds(
  plan: SeatingPlan,
  groups: readonly (readonly string[])[],
): SeatingPlan {
  let next = plan;
  let tableIndex = 0;
  for (const keys of groups) {
    for (;;) {
      const table = next.tables[tableIndex];
      if (!table) return next;
      const result = seat(next, keys, table.id);
      if (result.left.length === 0) {
        next = result.plan;
        break;
      }
      // domácnost se nevešla: zůstane celá pohromadě u dalšího stolu
      tableIndex += 1;
    }
  }
  return next;
}
