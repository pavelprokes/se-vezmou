import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { cookieSpec } from "@/auth/cookie";
import { getHost } from "@/auth/request";
import { READ_ONLY, tenantRpc } from "@/lib/db/rpc";
import type { TenantIdentity } from "@/lib/db/transport";
import { i18nTextSchema } from "./i18n-text";

/**
 * Seznam věcných darů na webu páru (fáze 2). Dary a stav „zabráno“ jsou živá data z databáze
 * (`gift_list_public`), ne součást zveřejněného snímku. S PINem hostů je seznam jen pro hosta s relací
 * po PINu (rozhoduje databáze). Tokeny vlastních rezervací drží cookie tohoto prohlížeče, takže host
 * může svou rezervaci zrušit; kdo dar zarezervoval, se ostatním hostům nikdy neposílá.
 */

const publicSchema = z
  .object({
    locked: z.boolean(),
    items: z.array(
      z.object({
        id: z.string(),
        title: i18nTextSchema,
        description: i18nTextSchema.nullable(),
        url: z.string().nullable(),
        price: z.string().nullable(),
        reserved: z.boolean(),
      }),
    ),
  })
  .nullable();

export interface RegistryItem {
  id: string;
  title: z.infer<typeof i18nTextSchema>;
  description: z.infer<typeof i18nTextSchema> | null;
  url: string | null;
  price: string | null;
  reserved: boolean;
  /** Zarezervoval ho tento prohlížeč (může rezervaci zrušit). */
  mine: boolean;
}

export interface GiftRegistryView {
  locked: boolean;
  items: RegistryItem[];
}

const COOKIE_SECONDS = 365 * 24 * 60 * 60;
const MAX_TOKENS = 30;
const ENTRY = /^([0-9a-f-]{36}):([0-9a-f]{36})$/;

/** Tokeny rezervací z cookie: id daru -> token. */
export async function readGiftTokens(): Promise<Map<string, string>> {
  const raw = (await cookies()).get(cookieSpec("gifts", await getHost()).name)?.value ?? "";
  const tokens = new Map<string, string>();
  for (const part of raw.split(".")) {
    const match = ENTRY.exec(part);
    if (match) tokens.set(match[1], match[2]);
  }
  return tokens;
}

export async function writeGiftTokens(tokens: Map<string, string>): Promise<void> {
  const spec = cookieSpec("gifts", await getHost(), COOKIE_SECONDS);
  const value = [...tokens]
    .slice(-MAX_TOKENS)
    .map(([id, token]) => `${id}:${token}`)
    .join(".");
  (await cookies()).set({
    name: spec.name,
    value,
    ...spec.options,
    ...(value ? {} : { maxAge: 0 }),
  });
}

/** Dary pro hosta; `null`, když pár žádné nemá nebo je web po svatbě. */
export async function loadGiftRegistry(identity: TenantIdentity): Promise<GiftRegistryView | null> {
  const raw = publicSchema.parse(
    await tenantRpc<unknown>(identity, "gift_list_public", {}, "scalar", READ_ONLY),
  );
  if (!raw) return null;
  const tokens = raw.locked ? new Map<string, string>() : await readGiftTokens();
  return {
    locked: raw.locked,
    items: raw.items.map((item) => ({ ...item, mine: item.reserved && tokens.has(item.id) })),
  };
}
