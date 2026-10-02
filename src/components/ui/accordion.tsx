import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";

export interface AccordionItem {
  id: string;
  title: ReactNode;
  content: ReactNode;
}

export interface AccordionProps {
  items: readonly AccordionItem[];
  className?: string;
}

/**
 * Rozbalovací seznam (FAQ) na nativním `<details>`: funguje bez JavaScriptu, klávesnicí
 * (Enter, mezerník) i se čtečkami, které stav „rozbaleno“ ohlašují samy.
 */
export function Accordion({ items, className }: AccordionProps) {
  return (
    <div className={cn("border-hairline border-t", className)}>
      {items.map((item) => (
        <details key={item.id} className="group border-hairline border-b">
          <summary
            className={cn(
              "min-h-target flex cursor-pointer list-none items-center justify-between gap-4 py-3",
              "text-ink text-lg font-medium [&::-webkit-details-marker]:hidden",
            )}
          >
            <span>{item.title}</span>
            <Icon
              icon={ChevronDown}
              className="text-pine group-open:rotate-180 motion-safe:transition-transform"
            />
          </summary>
          <div className="text-muted pb-4">{item.content}</div>
        </details>
      ))}
    </div>
  );
}
