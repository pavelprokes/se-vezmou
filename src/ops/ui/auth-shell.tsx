import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/** Rámec obrazovek přihlášení operátora: hlavní oblast, nadpis a karta s obsahem. */
export function OpsAuthShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main id="obsah" tabIndex={-1} className="mx-auto w-full max-w-xl flex-1 px-4 py-12 sm:px-8">
      <h1 className="text-ink text-3xl font-medium sm:text-4xl">{title}</h1>
      {intro ? <p className="text-muted mt-4 max-w-prose text-lg">{intro}</p> : null}
      <Card className="mt-8">{children}</Card>
    </main>
  );
}
