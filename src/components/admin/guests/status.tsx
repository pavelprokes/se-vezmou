"use client";

import { CircleCheck, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";

/**
 * Stav akce slovy a ikonou (ne jen barvou) v živé oblasti: čtečky oznámí „Uloženo“ nebo
 * „Ukládám…“, aniž by se zaměření pohnulo (WCAG 4.1.3). Oblast je v DOM vždy.
 */
export function StatusMessage({
  state,
  children,
}: {
  state: "idle" | "busy" | "done";
  children?: ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" className="min-h-6">
      {children && state !== "idle" ? (
        <p className="text-ink flex items-center gap-2 font-medium">
          <Icon icon={state === "busy" ? LoaderCircle : CircleCheck} />
          <span>{children}</span>
        </p>
      ) : null}
    </div>
  );
}
