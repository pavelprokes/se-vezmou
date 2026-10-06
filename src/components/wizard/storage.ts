import { parseDraft, storableDraft, type WizardDraft } from "@/wizard/draft";

/**
 * Koncept průvodce v úložišti prohlížeče (FR-WZ-2, FR-WZ-3): bez účtu a bez serveru. Každé čtení
 * i zápis je v `try`, protože úložiště může chybět nebo vyhodit chybu (soukromé okno, zablokovaná
 * data webu). Když localStorage nejde, použije se sessionStorage (přežije obnovení stránky, ne
 * zavření karty) a průvodce o tom pár informuje. Poškozený záznam se bere jako žádný koncept.
 *
 * PIN hostů v prostém tvaru se do úložiště nikdy nezapisuje (OQ-64); starý záznam, který ho nese,
 * se při čtení hned přepíše očištěnou podobou.
 */

export const DRAFT_KEY = "sv-wizard-draft-v1";

function stores(): Storage[] {
  const out: Storage[] = [];
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      out.push(window[name]);
    } catch {
      // přístup k úložišti může sám vyhodit chybu
    }
  }
  return out;
}

/** Záznam ze starší verze průvodce, který nese neprázdný prostý PIN. */
function hasStoredPin(raw: string): boolean {
  try {
    const pin = (JSON.parse(raw) as { guestPin?: { pin?: unknown } } | null)?.guestPin?.pin;
    return typeof pin === "string" && pin !== "";
  } catch {
    return false;
  }
}

/** Koncept z prohlížeče, nebo `null`. Novější z obou úložišť vyhrává. */
export function readStoredDraft(): WizardDraft | null {
  let best: WizardDraft | null = null;
  for (const store of stores()) {
    try {
      const raw = store.getItem(DRAFT_KEY);
      if (!raw) continue;
      const parsed = parseDraft(JSON.parse(raw));
      const draft = parsed && storableDraft(parsed);
      if (draft && (!best || best.updatedAt < draft.updatedAt)) best = draft;
      if (draft && hasStoredPin(raw))
        store.setItem(DRAFT_KEY, JSON.stringify(storableDraft(draft)));
    } catch {
      // poškozený záznam přeskočíme
    }
  }
  return best;
}

/** `true`, pokud se koncept podařilo uložit do trvalého úložiště (localStorage). */
export function writeStoredDraft(draft: WizardDraft): boolean {
  const json = JSON.stringify(storableDraft(draft));
  try {
    window.localStorage.setItem(DRAFT_KEY, json);
    return true;
  } catch {
    // localStorage nejde: zkusíme aspoň relaci
  }
  try {
    window.sessionStorage.setItem(DRAFT_KEY, json);
  } catch {
    // koncept zůstane jen v paměti stránky
  }
  return false;
}

export function clearStoredDraft(): void {
  for (const store of stores()) {
    try {
      store.removeItem(DRAFT_KEY);
    } catch {
      // nic dalšího se dělat nedá
    }
  }
}
