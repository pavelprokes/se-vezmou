"use client";

import { Check, CircleAlert, SkipForward } from "lucide-react";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { STEP_COUNT, STEP_KEYS, stepState, type StepState, type WizardDraft } from "@/wizard/draft";
import { useT, type WizardKey } from "./i18n";

const stepName = (t: ReturnType<typeof useT>, step: number) =>
  t(`wizard.step.${STEP_KEYS[step - 1]}.name` as WizardKey);

function StateMark({ state }: { state: StepState }) {
  const t = useT();
  if (state === "todo") return null;
  const icon = state === "done" ? Check : state === "skipped" ? SkipForward : CircleAlert;
  return (
    <>
      <Icon icon={icon} size={16} />
      <span className="sr-only">, {t(`wizard.stepper.state.${state}` as WizardKey)}</span>
    </>
  );
}

/**
 * Ukazatel postupu: číslo kroku, stav (hotovo, přeskočeno, k opravě) a návrat na dokončený krok.
 * Stav nese text a ikona, ne jen barva (WCAG 1.4.1). Na mobilu je kompaktní: věta „Krok 4 z 9“,
 * ukazatel a rozbalovací seznam všech kroků.
 */
export function Stepper({ draft, onGoTo }: { draft: WizardDraft; onGoTo: (step: number) => void }) {
  const t = useT();
  // Rozbalený seznam kroků na mobilu se po výběru kroku zase sbalí.
  const [open, setOpen] = useState(false);
  const { step, reached } = draft.progress;
  const steps = Array.from({ length: STEP_COUNT }, (_, index) => index + 1);

  const items = (className: string) => (
    <ol className={className}>
      {steps.map((number) => {
        const state = stepState(draft, number);
        const current = number === step;
        const enabled = number <= reached;
        return (
          <li key={number}>
            <button
              type="button"
              disabled={!enabled}
              aria-current={current ? "step" : undefined}
              onClick={() => {
                setOpen(false);
                onGoTo(number);
              }}
              className={cn(
                "min-h-target rounded-button flex w-full items-center gap-2 border-2 px-3 text-start text-base",
                enabled ? "cursor-pointer" : "cursor-not-allowed opacity-70",
                current
                  ? "border-pine bg-pine text-parchment font-semibold"
                  : state === "invalid"
                    ? "border-cinnamon-deep text-cinnamon-deep"
                    : "border-hairline hover:bg-linen text-ink",
              )}
            >
              <span aria-hidden="true" className="font-semibold">
                {number}.
              </span>
              <span className="flex-1">{stepName(t, number)}</span>
              <StateMark state={state} />
            </button>
          </li>
        );
      })}
    </ol>
  );

  return (
    <nav aria-label={t("wizard.stepper.label")} className="flex flex-col gap-2">
      <p className="text-muted text-sm" data-testid="step-counter">
        {t("wizard.stepper.current", {
          number: step,
          total: STEP_COUNT,
          name: stepName(t, step),
        })}
      </p>
      <div
        role="progressbar"
        aria-label={t("wizard.stepper.progress")}
        aria-valuemin={1}
        aria-valuemax={STEP_COUNT}
        aria-valuenow={step}
        aria-valuetext={t("wizard.stepper.progressText", { number: step, total: STEP_COUNT })}
        className="bg-linen h-2 w-full overflow-hidden rounded-full"
      >
        <div className="bg-pine h-full" style={{ width: `${(step / STEP_COUNT) * 100}%` }} />
      </div>
      <details
        className="lg:hidden"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className="min-h-target text-pine flex cursor-pointer items-center font-medium underline underline-offset-4">
          {t("wizard.stepper.all")}
        </summary>
        {items("mt-2 flex flex-col gap-1")}
      </details>
      <div className="hidden lg:block">{items("grid grid-cols-3 gap-1")}</div>
    </nav>
  );
}
