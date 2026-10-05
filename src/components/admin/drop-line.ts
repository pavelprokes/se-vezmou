import type { DragEvent } from "react";

/** Přetažení v seznamu: puštění na dolní polovinu cíle znamená „za něj“, na horní „před něj“. */
export type DropAt = { id: string; after: boolean };

export function dropAt(event: DragEvent<HTMLElement>, id: string): DropAt {
  const rect = event.currentTarget.getBoundingClientRect();
  return { id, after: event.clientY > rect.top + rect.height / 2 };
}

/** Čára nad cílem, nebo pod ním: ukazuje, kam položka po puštění dopadne. */
export function dropLine(over: DropAt | null, id: string): string | false {
  return (
    over?.id === id &&
    (over.after ? "shadow-[0_4px_0_0_var(--color-pine)]" : "shadow-[0_-4px_0_0_var(--color-pine)]")
  );
}
