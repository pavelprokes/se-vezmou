import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";

/**
 * Vysvětlivka pojmu („Co je adresa webu?“): nativní `<details>`, takže funguje bez JavaScriptu,
 * klávesnicí a čtečky ohlásí rozbaleno/sbaleno. Nese jen doplňující „proč a jak“; co je nutné
 * k vyplnění nebo nevratné, patří do nápovědy pole (vždy viditelné), ne sem. Žádný tooltip (1.4.13).
 */
export function Explainer({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details
      className={cn("border-hairline bg-warm rounded-2xl border", className)}
      data-testid="explainer"
    >
      <summary className="min-h-target text-pine flex cursor-pointer items-center gap-2 px-4 py-2 font-medium">
        <Icon icon={CircleHelp} />
        {title}
      </summary>
      <div className="text-ink flex flex-col gap-2 px-4 pt-1 pb-4">{children}</div>
    </details>
  );
}
