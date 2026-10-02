"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAdminT } from "./i18n";

/**
 * Nevratnější akce potvrzuje druhým krokem přímo v místě (bez vyskakovacího okna): první klik
 * ukáže otázku s tlačítky Ano a Zrušit a přesune na ni zaměření, Escape krok zruší. Po zavření otázky se zaměření vrací na tlačítko.
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
  const trigger = useRef<HTMLButtonElement>(null);
  // Po zavření otázky (Escape, Zrušit i Ano) se zaměření vrací na tlačítko, jinak by spadlo na `body`.
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (asking) confirm.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      trigger.current?.focus();
    }
  }, [asking]);

  function close() {
    restoreFocus.current = true;
    setAsking(false);
  }

  if (!asking) {
    return (
      // `aria-disabled` místo `disabled`: tlačítko, které se právě zaneprázdnilo, neztratí zaměření.
      <button
        ref={trigger}
        type="button"
        className={buttonVariants({ variant })}
        aria-disabled={disabled || undefined}
        aria-label={ariaLabel}
        onClick={() => {
          if (!disabled) setAsking(true);
        }}
      >
        {label}
      </button>
    );
  }
  return (
    <div
      role="group"
      aria-label={question}
      className="border-hairline bg-warm flex flex-col gap-2 rounded-2xl border p-3"
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <p className="text-ink font-medium">{question}</p>
      <div className="flex flex-wrap gap-2">
        <button
          ref={confirm}
          type="button"
          className={buttonVariants()}
          onClick={() => {
            close();
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
        <Button type="button" variant="secondary" onClick={close}>
          {t("admin.common.cancel")}
        </Button>
      </div>
    </div>
  );
}
