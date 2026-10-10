import { z } from "zod";
import { httpsUrl } from "@/site/types";

/** Soukromé poznámky a kontakty na dodavatele (fáze 2); hostům se nikdy nezobrazují. */

export const vendorCategories = [
  "photo",
  "video",
  "venue",
  "catering",
  "cake",
  "flowers",
  "music",
  "decor",
  "attire",
  "beauty",
  "transport",
  "officiant",
  "other",
] as const;
export type VendorCategory = (typeof vendorCategories)[number];

export const vendorStatuses = ["idea", "contacted", "booked"] as const;
export type VendorStatus = (typeof vendorStatuses)[number];

export interface Vendor {
  id: string;
  category: VendorCategory;
  name: string;
  contact: string | null;
  url: string | null;
  price: string | null;
  status: VendorStatus;
  note: string | null;
}

export const vendorInputSchema = z.object({
  category: z.enum(vendorCategories),
  name: z.string().trim().min(1).max(120),
  contact: z.string().trim().max(200).nullable().default(null),
  url: z
    .union([httpsUrl, z.literal("")])
    .nullable()
    .default(null),
  price: z.string().trim().max(60).nullable().default(null),
  status: z.enum(vendorStatuses).default("idea"),
  note: z.string().trim().max(2000).nullable().default(null),
});
export type VendorInput = z.input<typeof vendorInputSchema>;

export const NOTES_MAX = 20000;
