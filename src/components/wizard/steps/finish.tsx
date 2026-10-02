"use client";

import { Eye, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormAlert } from "@/components/ui/form-alert";
import { Icon } from "@/components/ui/icon";
import type { Issue, WizardDraft } from "@/wizard/draft";
import { useT } from "../i18n";
import { PreviewLink } from "../preview-link";

/**
 * Krok 9: uložit jako neveřejný koncept, nebo zveřejnit. Obě akce vyžadují kroky 1 až 3 a ověřený
 * e-mail (při prvním uložení se zeptáme na e-mail a kód). Zveřejnění navíc úplný a platný koncept.
 */
export function StepFinish({
  draft,
  domain,
  signedIn,
  canSave,
  issues,
  busy,
  error,
  previewUrl,
  onSave,
  onPublish,
  onRenewPreview,
  onGoToReview,
}: {
  draft: WizardDraft;
  domain: string;
  signedIn: boolean;
  canSave: boolean;
  issues: Issue[];
  busy: "save" | "publish" | null;
  error: string | null;
  previewUrl: string | null;
  onSave: () => void;
  onPublish: () => void;
  onRenewPreview: () => void;
  onGoToReview: () => void;
}) {
  const t = useT();
  const address = draft.slug ? `${draft.slug}.${domain}` : "";
  const publishable = issues.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <FormAlert>{error}</FormAlert>

      {signedIn ? null : (
        <p className="bg-linen rounded-button px-3 py-2" data-testid="finish-account-note">
          {t("wizard.finish.accountNote")}
        </p>
      )}

      <Card as="section" aria-labelledby="wz-finish-save" className="flex flex-col gap-3">
        <h2 id="wz-finish-save" className="flex items-center gap-2 text-xl font-medium">
          <Icon icon={Eye} size={22} />
          {t("wizard.finish.save.title")}
        </h2>
        <p>{t("wizard.finish.save.body")}</p>
        <ul className="list-disc ps-5">
          <li>{t("wizard.finish.save.point.private")}</li>
          <li>{t("wizard.finish.save.point.preview")}</li>
          <li>{t("wizard.finish.save.point.reservation")}</li>
        </ul>
        {canSave ? null : (
          <p className="text-cinnamon-deep text-sm">{t("wizard.finish.save.blocked")}</p>
        )}
        <Button
          className="self-start"
          variant="secondary"
          onClick={onSave}
          disabled={!canSave || busy !== null}
          aria-disabled={!canSave || busy !== null || undefined}
        >
          {busy === "save" ? t("wizard.finish.saving") : t("wizard.finish.save.button")}
        </Button>
        {previewUrl ? (
          <PreviewLink url={previewUrl} onRenew={onRenewPreview} busy={busy !== null} />
        ) : null}
      </Card>

      <Card as="section" aria-labelledby="wz-finish-publish" className="flex flex-col gap-3">
        <h2 id="wz-finish-publish" className="flex items-center gap-2 text-xl font-medium">
          <Icon icon={Rocket} size={22} />
          {t("wizard.finish.publish.title")}
        </h2>
        <p>{t("wizard.finish.publish.body", { address })}</p>
        <ul className="list-disc ps-5">
          <li>{t("wizard.finish.publish.point.permanent")}</li>
          <li>{t("wizard.finish.publish.point.indexing")}</li>
          <li>{t("wizard.finish.publish.point.edit")}</li>
        </ul>
        {publishable ? null : (
          <div role="note" className="border-cinnamon-deep rounded-button border-2 px-3 py-2">
            <p className="text-cinnamon-deep font-medium">
              {t("wizard.finish.publish.blocked", { count: issues.length })}
            </p>
            <Button variant="text" onClick={onGoToReview}>
              {t("wizard.finish.publish.toReview")}
            </Button>
          </div>
        )}
        <Button
          className="self-start"
          onClick={onPublish}
          disabled={!publishable || busy !== null}
          aria-disabled={!publishable || busy !== null || undefined}
        >
          {busy === "publish" ? t("wizard.finish.publishing") : t("wizard.finish.publish.button")}
        </Button>
      </Card>
    </div>
  );
}
