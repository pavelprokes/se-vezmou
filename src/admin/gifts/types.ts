import { z } from "zod";
import { httpsUrl } from "@/site/types";
import { i18nTextSchema, type I18nText } from "@/site/i18n-text";

/** Věcný dar ve správě (fáze 2): název a popis po jazycích, odkaz do obchodu, orientační cena. */
export interface GiftItem {
  id: string;
  title: I18nText;
  description: I18nText | null;
  url: string | null;
  price: string | null;
  /** Kdy si ho host zarezervoval; `null` = volný. */
  reservedAt: string | null;
  /** Nepovinné jméno, které host u rezervace uvedl (smaže se s údaji hostů). */
  reservedBy: string | null;
}

const limited = (max: number) =>
  i18nTextSchema.refine((value) =>
    Object.values(value).every((text) => (text ?? "").length <= max),
  );

export const giftInputSchema = z.object({
  title: limited(120),
  description: limited(500).nullable().default(null),
  url: z
    .union([httpsUrl, z.literal("")])
    .nullable()
    .default(null),
  price: z.string().max(40).nullable().default(null),
});
export type GiftInput = z.input<typeof giftInputSchema>;
