"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export interface HeaderMenuProps {
  /** Přeložený popisek tlačítka (`Nabídka`). */
  buttonLabel: string;
  children: ReactNode;
}

/**
 * Mobilní nabídka jako rozbalovací panel (disclosure): tlačítko s `aria-expanded` a `aria-controls`,
 * Escape panel zavře a vrátí zaměření na tlačítko, klepnutí na odkaz ho zavře. Od šířky `md` je
 * panel vždy vidět a tlačítko zmizí. Bez JavaScriptu (`@media (scripting: none)` v `globals.css`) je panel vždy rozbalený
 * a tlačítko skryté, takže navigace zůstane dostupná. Obsah (navigace, přepínač jazyka) se vykresluje na serveru.
 */
export function HeaderMenu({ buttonLabel, children }: HeaderMenuProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="header-menu-button min-h-target rounded-button border-pine text-pine hover:bg-linen inline-flex cursor-pointer items-center gap-2 border-2 px-4 font-medium md:hidden"
      >
        <Icon icon={open ? X : Menu} />
        {buttonLabel}
      </button>
      <div
        id={panelId}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) setOpen(false);
        }}
        className={cn(
          "header-menu-panel w-full flex-col gap-4 pb-2 md:flex md:w-auto md:flex-row md:items-center md:gap-6 md:pb-0",
          open ? "flex" : "hidden",
        )}
      >
        {children}
      </div>
    </>
  );
}
