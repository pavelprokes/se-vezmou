"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAdminT } from "./i18n";

/**
 * Nevratnější akce potvrzuje druhým krokem přímo v místě (bez vyskakovacího okna): první klik
 * ukáže otázku s tlačítky Ano a Zrušit a přesune na ni zaměření, Escape krok zruší.
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  onConfirm,
  disabled,
  variant = "secondary",
  ariaLabel,
}: {
  label: ReactNode;
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "text";
  /** Přesnější název tlačítka, když se stejný text opakuje (musí začínat viditelným textem). */
  ariaLabel?: string;
}) {
  const t = useAdminT();
  const [asking, setAsking] = useState(false);
  const confirm = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (asking) confirm.current?.focus();
  }, [asking]);

  if (!asking) {
    return (
      <Button
        type="button"
        variant={variant}
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setAsking(true)}
      >
        {label}
      </Button>
    );
  }
  return (
    <div
      role="group"
      aria-label={question}
      className="border-hairline bg-warm flex flex-col gap-2 rounded-2xl border p-3"
      onKeyDown={(event) => {
        if (event.key === "Escape") setAsking(false);
      }}
    >
      <p className="text-ink font-medium">{question}</p>
      <div className="flex flex-wrap gap-2">
        <button
          ref={confirm}
          type="button"
          className={buttonVariants()}
          onClick={() => {
            setAsking(false);
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
        <Button type="button" variant="secondary" onClick={() => setAsking(false)}>
          {t("admin.common.cancel")}
        </Button>
      </div>
    </div>
  );
}
