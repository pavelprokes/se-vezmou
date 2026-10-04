"use client";

import { useEffect, useState } from "react";

/** Tlačítko „Kopírovat“ s hlášením pro čtečky; bez schránky (nezabezpečený kontext) se nic nestane. */
export function CopyButton({
  value,
  label,
  copiedLabel,
  text,
  className = "site-btn site-btn-secondary",
  statusClassName = "site-muted",
}: {
  value: string;
  /** Přístupný název tlačítka, např. „Kopírovat: IBAN“. */
  label: string;
  copiedLabel: string;
  /** Viditelný text tlačítka. */
  text: string;
  /** Třídy tlačítka a hlášení; výchozí jsou pro web páru, správa předává své. */
  className?: string;
  statusClassName?: string;
}) {
  const [copied, setCopied] = useState(false);

  // Hlášení po chvíli zmizí, aby další kopírování (jiný údaj i stejný) zase zaznělo
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <button type="button" className={className} aria-label={label} onClick={copy}>
        {text}
      </button>
      <span role="status" className={statusClassName}>
        {copied ? copiedLabel : ""}
      </span>
    </>
  );
}
