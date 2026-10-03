import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";

export interface FormAlertProps {
  /** Chybová zpráva celého formuláře; bez zprávy zůstane jen prázdná živá oblast. */
  children?: ReactNode;
  className?: string;
  /** Kvůli přesunu zaměření na chybu celého formuláře (`document.getElementById(id)?.focus()`). */
  id?: string;
}

/**
 * Chyba celého formuláře (např. "Kód nesouhlasí"). Živá oblast `role="alert"` je v DOM vždy,
 * aby čtečky novou zprávu po odeslání spolehlivě oznámily (WCAG 4.1.3). Chyba je text s ikonou,
 * ne jen barva (WCAG 1.4.1).
 */
export function FormAlert({ children, className, id }: FormAlertProps) {
  return (
    <div role="alert" id={id} tabIndex={-1} className={className}>
      {children ? (
        <p
          className={cn(
            "text-cinnamon-deep border-cinnamon-deep bg-parchment rounded-button flex items-start gap-2 border-2 px-3 py-2 text-base font-medium",
          )}
        >
          <Icon icon={CircleAlert} size={20} className="mt-0.5 shrink-0" />
          <span>{children}</span>
        </p>
      ) : null}
    </div>
  );
}
