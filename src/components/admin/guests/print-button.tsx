"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/** Tlačítko tisku stránky (kartičky s QR); při tisku samo zmizí. */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" className="print:hidden" onClick={() => window.print()}>
      <Icon icon={Printer} size={18} />
      {label}
    </Button>
  );
}
