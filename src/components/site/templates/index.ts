import type { ComponentType } from "react";
import type { TemplateKey } from "@/site/themes/palettes";
import { ChateauSite } from "./chateau";
import type { TemplateProps } from "./classic";
import { EditorialSite } from "./editorial";
import { EukalyptusSite } from "./eukalyptus/index";
import { ModernSite } from "./modern";

export type { TemplateProps };

/**
 * Šablony webu páru. Každá je samostatná komponenta nad společným kontextem (`SiteCtx`), kostrou stránky
 * (`SiteLayout`) a modely bloků (`../models`); sdílené bloky (`../blocks`) a prvky (PIN, RSVP, galerie,
 * mapa) může použít, nebo nahradit vlastními.
 */
export const TEMPLATES: Record<TemplateKey, ComponentType<TemplateProps>> = {
  editorial: EditorialSite,
  eukalyptus: EukalyptusSite,
  chateau: ChateauSite,
  modern: ModernSite,
};
