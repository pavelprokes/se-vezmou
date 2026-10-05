"use client";

import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Field, Fieldset } from "@/components/ui/field";
import { Radio } from "@/components/ui/choice";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { checkSlugAction, type CheckSlugResult } from "@/app/h/app/vytvorit/actions";
import {
  slugFromNames,
  normalizeSlugInput,
  slugProblem,
  slugRevealsYear,
  variantBase,
  variantKind,
  dateSuffix,
} from "@/wizard/slug";
import type { WizardDraft } from "@/wizard/draft";
import { fieldId } from "./fields";
import { useT, type WizardKey } from "./i18n";

/** Kolize adresy: varianty z databáze (`reserve_slug`), které nejsou rezervované ani použité. */
export interface SlugConflict {
  variants: string[];
}

type Remote = { slug: string; result: CheckSlugResult };

const CHECK_DELAY_MS = 600;

/**
 * Adresa webu (FR-WZ-4): živá kontrola dostupnosti je jen informativní (omezená a bez rozlišení,
 * proč adresa není k dispozici); skutečnou rezervaci provede až první uložení. Při kolizi
 * se nabídnou varianty a pár upozorníme, že rok v adrese prozradí rok svatby.
 */
export function SlugField({
  draft,
  onSlugChange,
  domain,
  error,
  conflict,
  onDismissConflict,
}: {
  draft: WizardDraft;
  onSlugChange: (slug: string, edited: boolean) => void;
  /** Doména pro zobrazení (`se-vezmou.cz`, lokálně `localhost:3100`). */
  domain: string;
  error?: ReactNode;
  conflict: SlugConflict | null;
  onDismissConflict: () => void;
}) {
  const t = useT();
  const id = useId();
  const hintId = `${id}-hint`;
  const statusId = `${id}-status`;
  const domainId = `${id}-domain`;
  // Průvodce adresu při psaní upraví (malá písmena, bez háčků, mezera -> pomlčka); řekne to nahlas.
  const [adjusted, setAdjusted] = useState(false);
  const change = (raw: string, final: boolean) => {
    const next = normalizeSlugInput(raw, { final });
    // trvale: stačí jedna úprava (třeba velké písmeno na začátku), aby o ní pár věděl
    if (next !== raw) setAdjusted(true);
    onSlugChange(next, true);
  };
  const slug = draft.slug;
  const [remote, setRemote] = useState<Remote | null>(null);

  const localProblem = slugProblem(slug);

  // Dotaz na databázi až po chvíli bez psaní a jen pro adresu, která projde místními pravidly.
  useEffect(() => {
    if (slugProblem(slug) !== null) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await checkSlugAction(slug);
      if (!cancelled) setRemote({ slug, result });
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug]);

  let status: { tone: "ok" | "bad" | "info"; text: string } | null = null;
  if (localProblem === "reserved") {
    status = { tone: "bad", text: t("wizard.slug.unavailable") };
  } else if (localProblem === "empty") {
    status = null;
  } else if (localProblem) {
    status = { tone: "bad", text: t(`wizard.slug.problem.${localProblem}` as WizardKey) };
  } else if (!remote || remote.slug !== slug) {
    status = { tone: "info", text: t("wizard.slug.checking") };
  } else {
    switch (remote.result.status) {
      case "available":
        status = { tone: "ok", text: t("wizard.slug.available") };
        break;
      case "unavailable":
        status = { tone: "bad", text: t("wizard.slug.unavailable") };
        break;
      case "invalid":
        status = { tone: "bad", text: t("wizard.slug.problem.format") };
        break;
      case "limited":
        status = { tone: "info", text: t("wizard.slug.limited") };
        break;
      case "error":
        status = { tone: "info", text: t("wizard.slug.error") };
        break;
    }
  }

  // Vlastní doplněk k obsazené adrese (místo svatby nebo datum): pár ho napíše, nebo vloží datum.
  const [extra, setExtra] = useState("");
  const base = conflict?.variants[0] ? variantBase(conflict.variants[0]) : slug;
  const extraSlug = normalizeSlugInput(extra, { final: true });
  const weddingDate = dateSuffix(draft.startsOn);

  const suggestion = slugFromNames(draft.partnerA, draft.partnerB, draft.defaultLocale);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId("slug")} className="text-ink font-medium">
          {t("wizard.slug.label")}
        </label>
        <p id={hintId} className="text-muted text-sm">
          {t("wizard.slug.hint")}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <input
            id={fieldId("slug")}
            type="text"
            value={slug}
            maxLength={63}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
            aria-invalid={error ? true : undefined}
            aria-required="true"
            // koncovka „.se-vezmou.cz“ patří k adrese, čtečka ji bez ní neuslyší (1.3.1)
            aria-describedby={[domainId, hintId, statusId].join(" ")}
            onChange={(event) => change(event.target.value, false)}
            onBlur={(event) => change(event.target.value, true)}
            className={cn(
              "min-h-target rounded-button bg-parchment text-ink min-w-0 flex-1 basis-48 border-2 px-3 py-2 text-base",
              error ? "border-cinnamon-deep" : "border-field-border",
            )}
          />
          <span
            id={domainId}
            className="text-ink font-semibold break-all"
            data-testid="slug-domain"
          >
            .{domain}
          </span>
        </div>
        <div id={statusId} role="status" aria-live="polite" className="min-h-6">
          {error ? (
            <p className="text-cinnamon-deep flex items-start gap-2 text-sm font-medium">
              <Icon icon={CircleAlert} size={18} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          ) : status ? (
            <p
              data-testid="slug-status"
              className={cn(
                "flex items-start gap-2 text-sm font-medium",
                status.tone === "bad" ? "text-cinnamon-deep" : "text-ink",
              )}
            >
              <Icon
                icon={
                  status.tone === "ok" ? CircleCheck : status.tone === "bad" ? CircleAlert : Info
                }
                size={18}
                className="mt-0.5 shrink-0"
              />
              <span>{status.text}</span>
            </p>
          ) : null}
          {adjusted ? (
            <p className="text-muted text-sm" data-testid="slug-adjusted">
              {t("wizard.slug.adjusted")}
            </p>
          ) : null}
        </div>
        {draft.slugEdited && suggestion !== "" && suggestion !== slug ? (
          <Button
            variant="text"
            className="self-start"
            onClick={() => onSlugChange(suggestion, false)}
          >
            {t("wizard.slug.useSuggestion", { slug: suggestion })}
          </Button>
        ) : null}
      </div>

      {slugRevealsYear(slug) ? (
        <p role="note" className="bg-linen rounded-button flex items-start gap-2 px-3 py-2 text-sm">
          <Icon icon={Info} size={18} className="mt-0.5 shrink-0" />
          <span>{t("wizard.slug.yearWarning")}</span>
        </p>
      ) : null}

      <p className="text-muted text-sm">{t("wizard.slug.reservationNote")}</p>

      {conflict ? (
        <div
          role="alert"
          className="border-cinnamon-deep bg-parchment rounded-2xl border-2 p-4"
          data-testid="slug-conflict"
        >
          <Fieldset legend={t("wizard.slug.conflict.legend")}>
            <p className="mb-2 text-sm">{t("wizard.slug.conflict.body")}</p>
            {conflict.variants.map((variant) => {
              const kind = variantKind(variant);
              return (
                <Radio
                  key={variant}
                  name="wz-slug-variant"
                  checked={slug === variant}
                  onChange={() => onSlugChange(variant, true)}
                  label={
                    <span className="flex flex-col">
                      <span className="font-semibold break-all">
                        {variant}.{domain}
                      </span>
                      {kind ? (
                        <span className="text-muted text-sm">
                          {t(`wizard.slug.variant.${kind}` as WizardKey)}
                        </span>
                      ) : null}
                    </span>
                  }
                />
              );
            })}
          </Fieldset>
          <div className="mt-4 flex flex-col gap-2">
            <Field
              label={t("wizard.slug.extra.label")}
              hint={t("wizard.slug.extra.hint", { base })}
              value={extra}
              onChange={(event) => setExtra(event.target.value)}
              autoComplete="off"
              maxLength={40}
              data-testid="slug-extra"
            />
            <div className="flex flex-wrap gap-2">
              {weddingDate ? (
                <Button variant="text" onClick={() => setExtra(weddingDate)}>
                  {t("wizard.slug.extra.date")}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                disabled={extraSlug === ""}
                onClick={() =>
                  onSlugChange(normalizeSlugInput(`${base}-${extraSlug}`, { final: true }), true)
                }
              >
                {extraSlug
                  ? t("wizard.slug.extra.apply", { slug: `${base}-${extraSlug}` })
                  : t("wizard.slug.extra.applyEmpty")}
              </Button>
            </div>
          </div>
          <Button variant="text" className="mt-2" onClick={onDismissConflict}>
            {t("wizard.slug.conflict.dismiss")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
