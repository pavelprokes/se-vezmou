"use client";

import { CircleCheck } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";

/**
 * Hlášení o provedeném zásahu na stránce zakázky. Po zásahu se stránka načte znovu (přesměrování),
 * takže formulář, který zásah odeslal, už nemusí existovat (např. po zablokování zmizí nabídka stavů).
 * Hlášení proto žije mimo formulář: je to živá oblast `role="status"` a po zobrazení si bere zaměření,
 * aby ho čtečky i klávesnice nepřehlédly (WCAG 4.1.3).
 */
export function ResultBanner({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      role="status"
      tabIndex={-1}
      className="border-pine bg-linen text-ink rounded-button mb-6 flex items-start gap-2 border-2 px-4 py-3 font-medium"
    >
      <Icon icon={CircleCheck} size={22} className="mt-0.5" />
      <p>{children}</p>
    </div>
  );
}
