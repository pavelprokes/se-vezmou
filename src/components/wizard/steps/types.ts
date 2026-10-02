import type { WizardDraft } from "@/wizard/draft";
import type { FieldErrors } from "../fields";

/** Společné vlastnosti kroků průvodce. */
export interface StepProps {
  draft: WizardDraft;
  /** Změna konceptu; průvodce ji uloží do prohlížeče a (po prvním uložení) na server. */
  update: (change: (draft: WizardDraft) => WizardDraft) => void;
  /** Chyby k zobrazení po pokusu o pokračování. */
  errors: FieldErrors;
  /** Aktivní „obrazovka“ kroku (na mobilu je vidět jen ona). */
  screen: number;
  mobile: boolean;
}

/** Počet obrazovek (malých skupin otázek) v krocích 1 až 9. */
export const SCREEN_COUNTS = [2, 2, 2, 3, 4, 2, 1, 1, 1] as const;

/** Do které obrazovky kroku patří pole z chybového seznamu (pro kontrolu po částech na mobilu). */
export function screenOfField(step: number, field: string): number {
  switch (step) {
    case 1:
      return field === "locales" ? 1 : 0;
    case 2:
      return field === "slug" ? 1 : 0;
    case 3:
      return field === "palette" ? 1 : 0;
    case 4:
      if (field.startsWith("ceremony")) return 0;
      if (field.startsWith("reception")) return 1;
      return 2;
    case 5:
      if (field === "dressCode") return 0;
      if (field.startsWith("lodging")) return 1;
      if (field === "transport") return 2;
      return 3;
    case 6:
      return field === "deadline" ? 0 : 1;
    default:
      return 0;
  }
}
