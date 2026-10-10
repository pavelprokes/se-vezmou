import type { Locale } from "@/i18n/config";
import { typo } from "@/i18n/typo";

/**
 * Texty cedulky. Tisknou se v jazyce hostů (jazyky webu páru), ne v jazyce správy, proto jsou tady
 * a ne v překladech rozhraní. Dvě varianty: `upload` (galerie, kam hosté fotky přidávají) a `view`
 * (jen prohlížení). Věta „bez aplikace a bez registrace“ platí jen pro vlastní galerii autora, kde
 * to víme; u cizí galerie ji vynecháváme.
 */

export const gallerySignVariants = ["upload", "view"] as const;
export type GallerySignVariant = (typeof gallerySignVariants)[number];

const COPY = {
  cs: {
    upload: {
      heading: "Přidejte své fotky",
      instruction: "Naskenujte QR kód fotoaparátem telefonu a nahrajte fotky do společné galerie.",
    },
    view: {
      heading: "Fotky ze svatby",
      instruction: "Naskenujte QR kód fotoaparátem telefonu a prohlédněte si fotky ze svatby.",
    },
    noApp: "Bez aplikace a bez registrace.",
  },
  en: {
    upload: {
      heading: "Share your photos",
      instruction:
        "Scan the QR code with your phone camera and add your photos to the shared gallery.",
    },
    view: {
      heading: "Wedding photos",
      instruction: "Scan the QR code with your phone camera to see the wedding photos.",
    },
    noApp: "No app, no sign-up.",
  },
} as const satisfies Record<Locale, unknown>;

export function signCopy(
  locale: Locale,
  variant: GallerySignVariant,
  ownGallery: boolean,
): { heading: string; instruction: string } {
  const copy = COPY[locale];
  const texts = copy[variant];
  const instruction = ownGallery ? `${texts.instruction} ${copy.noApp}` : texts.instruction;
  return { heading: typo(texts.heading, locale), instruction: typo(instruction, locale) };
}
