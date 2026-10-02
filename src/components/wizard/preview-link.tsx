"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useT } from "./i18n";

/**
 * Neuhádnutelný odkaz na náhled konceptu (FR-WZ-5). V databázi je jen jeho hash, proto se
 * zobrazuje jen po vytvoření; ztracený odkaz nahradí nový a starý přestane platit.
 */
export function PreviewLink({
  url,
  onRenew,
  busy,
}: {
  url: string;
  onRenew: () => void;
  busy: boolean;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="preview-link">
      <Field
        label={t("wizard.previewLink.label")}
        hint={t("wizard.previewLink.hint")}
        value={url}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
        autoComplete="off"
        spellCheck={false}
        data-testid="preview-link-input"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => void copy()}>
          {t("wizard.copy")}
        </Button>
        <Button variant="text" onClick={onRenew} disabled={busy}>
          {t("wizard.previewLink.renew")}
        </Button>
        <span role="status" className="text-sm">
          {copied ? t("wizard.copied") : ""}
        </span>
      </div>
      <p className="text-muted text-sm">{t("wizard.previewLink.warning")}</p>
    </div>
  );
}
