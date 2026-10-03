"use client";

import { Eye } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMediaQuery } from "usehooks-ts";
import {
  publishDraftAction,
  renewPreviewLinkAction,
  saveDraftAction,
  trackWizardEventAction,
} from "@/app/h/app/vytvorit/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Icon } from "@/components/ui/icon";
import { intlLocale, type Locale } from "@/i18n/config";
import {
  REQUIRED_STEPS,
  STEP_COUNT,
  STEP_KEYS,
  canSaveToServer,
  createDraft,
  parseDraft,
  validateDraft,
  type IssueCode,
  type WizardDraft,
} from "@/wizard/draft";
import { Done, type DoneInfo } from "./done";
import { fieldId, type FieldErrors } from "./fields";
import { useT, WizardI18nProvider, type WizardKey, type WizardMessages } from "./i18n";
import { PreviewDialog, PreviewPanel } from "./preview";
import { SaveDialog } from "./save-dialog";
import type { SlugConflict } from "./slug-field";
import { Stepper } from "./stepper";
import { StepAccess } from "./steps/access";
import { StepDate } from "./steps/date";
import { StepFinish } from "./steps/finish";
import { StepInfo } from "./steps/info";
import { StepNames } from "./steps/names";
import { StepProgram } from "./steps/program";
import { StepReview } from "./steps/review";
import { StepRsvp } from "./steps/rsvp";
import { StepTemplate } from "./steps/template";
import { SCREEN_COUNTS, screenOfField, type StepProps } from "./steps/types";
import { clearStoredDraft, readStoredDraft, writeStoredDraft } from "./storage";

export interface WizardAppProps {
  uiLocale: Locale;
  messages: WizardMessages;
  /** Doména pro zobrazení adresy webu (`se-vezmou.cz`, lokálně `localhost:3100`). */
  domain: string;
  /** Jména a jazyk z úvodní stránky (FR-LP-5). */
  prefill: { partnerA: string; partnerB: string; siteLocale: Locale };
  /** Koncept přihlášeného správce na serveru (návrh z jiného zařízení nebo po obnovení). */
  server: { draft: unknown; previewEnabled: boolean } | null;
}

type SaveStatus =
  | { kind: "local" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "incomplete" }
  | { kind: "limited" }
  | { kind: "error" };

const PREVIEW_URL_KEY = "sv-wizard-preview-url";
const DONE_KEY = "sv-wizard-done";

function readSession<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeSession(key: string, value: unknown | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // úložiště nemusí být k dispozici (soukromé okno); odkaz se prostě nezapamatuje
  }
}

/** Počáteční koncept: novější z prohlížeče a ze serveru, jinak nový s předvyplněnými jmény. */
function initialDraft(props: WizardAppProps): WizardDraft {
  const stored = readStoredDraft();
  const server = props.server ? parseDraft(props.server.draft) : null;
  let base: WizardDraft | null = stored;
  if (server && (!stored || stored.updatedAt < server.updatedAt)) base = server;
  if (!base) {
    return createDraft({
      locale: props.uiLocale,
      siteLocale: props.prefill.siteLocale,
      partnerA: props.prefill.partnerA,
      partnerB: props.prefill.partnerB,
    });
  }
  // Jména z úvodní stránky doplní jen prázdný koncept; rozepsaná data se nikdy nepřepisují.
  if (base.partnerA === "" && base.partnerB === "") {
    return {
      ...base,
      partnerA: props.prefill.partnerA,
      partnerB: props.prefill.partnerB,
      slug: base.slugEdited
        ? base.slug
        : createDraft({
            locale: props.uiLocale,
            siteLocale: base.defaultLocale,
            partnerA: props.prefill.partnerA,
            partnerB: props.prefill.partnerB,
          }).slug,
    };
  }
  return base;
}

/** Zpráva o uložení: jen text, ikona není potřeba, stav oznámí čtečce `role="status"`. */
function SaveStatusLine({ status, signedIn }: { status: SaveStatus; signedIn: boolean }) {
  const t = useT();
  let text: string;
  switch (status.kind) {
    case "saving":
      text = t("wizard.status.saving");
      break;
    case "saved":
      text = t("wizard.status.saved", {
        time: new Intl.DateTimeFormat(intlLocale[t.locale], {
          hour: "2-digit",
          minute: "2-digit",
        }).format(status.at),
      });
      break;
    case "incomplete":
      text = t("wizard.status.incomplete");
      break;
    case "limited":
      text = t("wizard.status.limited");
      break;
    case "error":
      text = t("wizard.status.error");
      break;
    default:
      text = signedIn ? t("wizard.status.saved.generic") : t("wizard.status.local");
  }
  return (
    <p role="status" className="text-muted text-sm" data-testid="save-status">
      {text}
    </p>
  );
}

function Wizard(props: WizardAppProps) {
  const { uiLocale, domain } = props;
  const t = useT();
  const router = useRouter();
  const [draft, setDraft] = useState<WizardDraft>(() => initialDraft(props));
  const [signedIn, setSignedIn] = useState(props.server !== null);
  // Co pár chtěl udělat, když se zeptáme na e-mail a kód: po ověření se v tom pokračuje (bez dalšího kliknutí).
  const signedInRef = useRef(props.server !== null);
  const intent = useRef<"save" | "publish">("save");
  const [screen, setScreen] = useState(0);
  const [attempted, setAttempted] = useState<number | null>(null);
  const [conflict, setConflict] = useState<SlugConflict | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "local" });
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readSession<string>(PREVIEW_URL_KEY),
  );
  const [done, setDone] = useState<DoneInfo | null>(() =>
    typeof window === "undefined" ? null : readSession<DoneInfo>(DONE_KEY),
  );
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveKey, setSaveKey] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const mobile = useMediaQuery("(max-width: 63.99rem)");
  const compact = useMediaQuery("(max-width: 47.99rem)");

  const draftRef = useRef(draft);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusField = useRef<string | null>(null);
  const [storageOk, setStorageOk] = useState(true);

  const step = draft.progress.step;
  const screens = SCREEN_COUNTS[step - 1];
  const activeScreen = compact ? Math.min(screen, screens - 1) : 0;
  const lastScreen = !compact || activeScreen >= screens - 1;
  const issues = validateDraft(draft);

  // --- změny konceptu a jejich uložení ---------------------------------------------------

  const update = useCallback((change: (draft: WizardDraft) => WizardDraft) => {
    setDraft((previous) => {
      const next = { ...change(previous), updatedAt: new Date().toISOString() };
      draftRef.current = next;
      return next;
    });
  }, []);

  // Průběžné ukládání do prohlížeče (FR-WZ-3): krátká prodleva a vždy při opuštění stránky.
  useEffect(() => {
    draftRef.current = draft;
    const timer = setTimeout(() => setStorageOk(writeStoredDraft(draft)), 300);
    return () => clearTimeout(timer);
  }, [draft]);

  useEffect(() => {
    const flush = () => writeStoredDraft(draftRef.current);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, []);

  // Měření bez osobních údajů: začátek průvodce a dokončení kroku, každé jednou za koncept.
  const track = useCallback(
    (event: "wizard_started" | "wizard_step_completed", stepNumber: number | null) => {
      const current = draftRef.current;
      if (
        event === "wizard_started"
          ? current.tracking.started
          : current.tracking.steps.includes(stepNumber ?? 0)
      ) {
        return;
      }
      setDraft((previous) => ({
        ...previous,
        tracking: {
          started: previous.tracking.started || event === "wizard_started",
          steps:
            event === "wizard_step_completed" && stepNumber
              ? [...previous.tracking.steps, stepNumber]
              : previous.tracking.steps,
        },
      }));
      void trackWizardEventAction({
        event,
        step: stepNumber,
        template: current.template,
      });
    },
    [],
  );

  // „Začal“ je pár, který po otevření průvodce něco zadal nebo změnil (ne ten, kdo jen stránku otevřel).
  const startSnapshot = useRef(
    JSON.stringify([draft.partnerA, draft.partnerB, draft.startsOn, draft.slug, draft.template]),
  );
  const currentSnapshot = JSON.stringify([
    draft.partnerA,
    draft.partnerB,
    draft.startsOn,
    draft.slug,
    draft.template,
  ]);
  useEffect(() => {
    if (currentSnapshot !== startSnapshot.current) track("wizard_started", null);
  }, [currentSnapshot, track]);

  // Ukládání na server po prvním uložení (autosave): jedno volání najednou, poslední stav vyhrává.
  const inFlight = useRef(false);
  const dirty = useRef(false);

  const applyServerResult = useCallback(
    (result: Awaited<ReturnType<typeof saveDraftAction>>) => {
      switch (result.status) {
        case "saved":
          if (result.slugStatus === "taken" || result.slugStatus === "invalid") {
            setConflict({ variants: result.variants });
          } else {
            setConflict(null);
          }
          setSaveStatus({ kind: "saved", at: new Date() });
          return;
        case "incomplete":
          setSaveStatus({ kind: "incomplete" });
          return;
        case "limited":
          setSaveStatus({ kind: "limited" });
          return;
        case "not_draft":
          // Web je mezitím zveřejněný (jiné zařízení): průvodce už nic neukládá.
          clearStoredDraft();
          router.replace("/");
          return;
        default:
          setSaveStatus({ kind: "error" });
      }
    },
    [router],
  );

  useEffect(() => {
    if (!signedIn || done) return;
    const timer = setTimeout(async () => {
      if (inFlight.current) {
        dirty.current = true;
        return;
      }
      inFlight.current = true;
      setSaveStatus({ kind: "saving" });
      try {
        do {
          dirty.current = false;
          applyServerResult(await saveDraftAction(draftRef.current));
        } while (dirty.current);
      } catch {
        setSaveStatus({ kind: "error" });
      } finally {
        inFlight.current = false;
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [draft, signedIn, done, applyServerResult]);

  // --- navigace mezi kroky --------------------------------------------------------------------

  const goTo = useCallback(
    (target: number, options: { screen?: number; field?: string } = {}) => {
      focusField.current = options.field ? fieldId(options.field) : null;
      setAttempted(options.field ? target : null);
      setScreen(options.screen ?? 0);
      update((d) => ({
        ...d,
        progress: {
          ...d.progress,
          step: target,
          reached: Math.max(d.progress.reached, target),
        },
      }));
    },
    [update],
  );

  // Po změně kroku nebo obrazovky: zaměření na chybné pole, jinak na nadpis (čtečka ho přečte).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const target = focusField.current ? document.getElementById(focusField.current) : null;
    focusField.current = null;
    if (target) target.focus();
    else heading.current?.focus();
  }, [step, activeScreen]);

  const stepIssues = (stepNumber: number, onlyScreen?: number) =>
    issues.filter(
      (issue) =>
        issue.step === stepNumber &&
        (onlyScreen === undefined || screenOfField(stepNumber, issue.field) === onlyScreen),
    );

  function next() {
    // Povinné kroky a rozepsané položky se kontrolují po částech (na mobilu po obrazovkách).
    const relevant = stepIssues(step, lastScreen ? undefined : activeScreen);
    if (relevant.length > 0 && step <= 7) {
      setAttempted(step);
      const first = relevant[0];
      if (compact) setScreen(screenOfField(step, first.field));
      focusField.current = fieldId(first.field);
      // znovu vykreslit i když je zaměření už na tomto kroku
      setTimeout(() => document.getElementById(fieldId(first.field))?.focus(), 0);
      return;
    }
    if (!lastScreen) {
      setScreen(activeScreen + 1);
      return;
    }
    update((d) => ({
      ...d,
      progress: {
        ...d.progress,
        done: d.progress.done.includes(step) ? d.progress.done : [...d.progress.done, step],
        skipped: d.progress.skipped.filter((n) => n !== step),
      },
    }));
    void track("wizard_step_completed", step);
    goTo(step + 1);
  }

  function back() {
    if (compact && activeScreen > 0) {
      setScreen(activeScreen - 1);
      return;
    }
    if (step > 1) {
      goTo(step - 1, { screen: compact ? SCREEN_COUNTS[step - 2] - 1 : 0 });
    }
  }

  function skip() {
    update((d) => ({
      ...d,
      progress: {
        ...d.progress,
        skipped: d.progress.skipped.includes(step)
          ? d.progress.skipped
          : [...d.progress.skipped, step],
        done: d.progress.done.filter((n) => n !== step),
      },
    }));
    goTo(step + 1);
  }

  function skipRest() {
    update((d) => {
      const skipped = [...d.progress.skipped];
      for (let n = step; n <= 8; n++) {
        if (!skipped.includes(n) && !d.progress.done.includes(n)) skipped.push(n);
      }
      return { ...d, progress: { ...d.progress, skipped } };
    });
    goTo(STEP_COUNT);
  }

  // --- ukládání, zveřejnění ---------------------------------------------------------------------

  /** Uložení: s relací nebo ověřeným e-mailem hned, jinak se nejdřív zeptáme na e-mail a kód. */
  async function save(): Promise<boolean> {
    setFinishError(null);
    setBusy("save");
    try {
      const result = await saveDraftAction(draftRef.current);
      switch (result.status) {
        case "created":
          signedInRef.current = true;
          setSignedIn(true);
          setSaveOpen(false);
          setPreviewUrl(result.previewUrl);
          writeSession(PREVIEW_URL_KEY, result.previewUrl);
          setConflict(null);
          setSaveStatus({ kind: "saved", at: new Date() });
          return true;
        case "saved":
          applyServerResult(result);
          if (result.slugStatus === "taken" || result.slugStatus === "invalid") {
            goTo(2, { screen: 1, field: "slug" });
            return false;
          }
          return true;
        case "taken":
          setSaveOpen(false);
          setConflict({ variants: result.variants });
          setFinishError(t("wizard.finish.error.taken"));
          goTo(2, { screen: 1, field: "slug" });
          return false;
        case "verify_required":
          setSaveKey((key) => key + 1);
          setSaveOpen(true);
          return false;
        case "incomplete":
          setSaveOpen(false);
          setFinishError(t("wizard.finish.error.incomplete"));
          return false;
        case "limited":
          setSaveOpen(false);
          setFinishError(t("wizard.finish.error.limited"));
          return false;
        case "not_draft":
          clearStoredDraft();
          router.replace("/");
          return false;
        default:
          setSaveOpen(false);
          setFinishError(t("wizard.finish.error.generic"));
          return false;
      }
    } finally {
      setBusy(null);
    }
  }

  function saveClicked() {
    intent.current = "save";
    void save();
  }

  async function publishNow() {
    if (!signedInRef.current) {
      // Zveřejnění potřebuje účet: nejdřív první uložení (e-mail, kód), pak se pokračuje.
      intent.current = "publish";
      const saved = await save();
      if (!saved) return;
    }
    intent.current = "save";
    setFinishError(null);
    setBusy("publish");
    try {
      const result = await publishDraftAction(draftRef.current);
      switch (result.status) {
        case "published": {
          const info: DoneInfo = {
            slug: result.slug,
            url: result.url,
            host: result.host,
            pin: result.pin,
          };
          writeSession(DONE_KEY, info);
          writeSession(PREVIEW_URL_KEY, null);
          clearStoredDraft();
          setDone(info);
          return;
        }
        case "slug_unavailable":
          setConflict({ variants: result.variants });
          setFinishError(t("wizard.finish.error.taken"));
          goTo(2, { screen: 1, field: "slug" });
          return;
        case "invalid":
          setFinishError(t("wizard.finish.error.invalid"));
          goTo(8);
          return;
        case "unauthorized":
          setFinishError(t("wizard.finish.error.unauthorized"));
          setSignedIn(false);
          return;
        case "not_draft":
          clearStoredDraft();
          router.replace("/");
          return;
        case "limited":
          setFinishError(t("wizard.finish.error.limited"));
          return;
        default:
          setFinishError(t("wizard.finish.error.generic"));
      }
    } finally {
      setBusy(null);
    }
  }

  async function renewPreview() {
    setBusy("save");
    try {
      const result = await renewPreviewLinkAction(draftRef.current.defaultLocale);
      if (result.status === "ok") {
        setPreviewUrl(result.previewUrl);
        writeSession(PREVIEW_URL_KEY, result.previewUrl);
      } else {
        setFinishError(t("wizard.finish.error.generic"));
      }
    } finally {
      setBusy(null);
    }
  }

  // --- vykreslení -----------------------------------------------------------------------------

  if (done) {
    return <Done info={done} uiLocale={uiLocale} />;
  }

  const errors: FieldErrors = new Map<string, IssueCode>(
    attempted === step
      ? stepIssues(step, lastScreen ? undefined : activeScreen).map((issue) => [
          issue.field,
          issue.code,
        ])
      : [],
  );
  const stepProps: StepProps = { draft, update, errors, screen: activeScreen, mobile: compact };
  const stepKey = STEP_KEYS[step - 1];
  const isOptional = step >= 4 && step <= 8;
  const canSave = canSaveToServer(draft);
  const requiredOk = REQUIRED_STEPS.every((n) => stepIssues(n).length === 0);

  return (
    <div className="wizard-page mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 pt-6 sm:px-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Stepper draft={draft} onGoTo={(target) => goTo(target)} />
          <main id="obsah" tabIndex={-1} className="flex min-w-0 flex-col gap-6">
            <div>
              <h1
                ref={heading}
                tabIndex={-1}
                id="wz-heading"
                className="text-3xl font-medium sm:text-4xl"
              >
                {t(`wizard.step.${stepKey}.title` as WizardKey)}
              </h1>
              <p className="text-muted mt-2">{t(`wizard.step.${stepKey}.intro` as WizardKey)}</p>
              {compact && screens > 1 ? (
                <p className="text-muted mt-1 text-sm" data-testid="screen-counter">
                  {t("wizard.stepper.screen", { current: activeScreen + 1, total: screens })}
                </p>
              ) : null}
            </div>

            {attempted === step && errors.size > 0 ? (
              <FormAlert>{t("wizard.errors.summary", { count: errors.size })}</FormAlert>
            ) : (
              <FormAlert />
            )}

            <div className="flex flex-col gap-6">
              {step === 1 ? <StepNames {...stepProps} /> : null}
              {step === 2 ? (
                <StepDate
                  {...stepProps}
                  domain={domain}
                  conflict={conflict}
                  onDismissConflict={() => setConflict(null)}
                />
              ) : null}
              {step === 3 ? <StepTemplate {...stepProps} /> : null}
              {step === 4 ? <StepProgram {...stepProps} /> : null}
              {step === 5 ? <StepInfo {...stepProps} /> : null}
              {step === 6 ? <StepRsvp {...stepProps} /> : null}
              {step === 7 ? <StepAccess {...stepProps} /> : null}
              {step === 8 ? (
                <StepReview
                  draft={draft}
                  issues={issues}
                  domain={domain}
                  onGoTo={(target, field) =>
                    goTo(target, { field, screen: field ? screenOfField(target, field) : 0 })
                  }
                />
              ) : null}
              {step === 9 ? (
                <StepFinish
                  draft={draft}
                  domain={domain}
                  signedIn={signedIn}
                  canSave={canSave}
                  issues={issues}
                  busy={busy}
                  error={finishError}
                  previewUrl={previewUrl}
                  onSave={saveClicked}
                  onPublish={() => void publishNow()}
                  onRenewPreview={() => void renewPreview()}
                  onGoToReview={() => goTo(8)}
                />
              ) : null}
            </div>

            {isOptional && step <= 4 ? (
              <p>
                <Button variant="text" onClick={skipRest}>
                  {t("wizard.nav.skipRest")}
                </Button>
              </p>
            ) : null}

            {!storageOk ? (
              <p role="note" className="bg-linen rounded-button px-3 py-2 text-sm">
                {t("wizard.status.storageOff")}
              </p>
            ) : null}
          </main>
        </div>

        <aside aria-label={t("wizard.preview.title")} className="hidden lg:block">
          <div className="sticky top-6">
            {mobile ? null : <PreviewPanel draft={draft} uiLocale={uiLocale} />}
          </div>
        </aside>
      </div>

      <div
        data-testid="wizard-bar"
        ref={trackBarHeight}
        className="bg-parchment border-hairline fixed inset-x-0 bottom-0 z-10 border-t px-4 py-3 sm:px-8"
      >
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <SaveStatusLine status={saveStatus} signedIn={signedIn} />
            <div className="flex items-center gap-2">
              {requiredOk && step > 3 && step < STEP_COUNT && !signedIn ? (
                <Button variant="text" onClick={saveClicked}>
                  {t("wizard.nav.save")}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                className="lg:hidden"
                onClick={() => setPreviewOpen(true)}
                aria-haspopup="dialog"
              >
                <Icon icon={Eye} size={18} />
                {t("wizard.nav.preview")}
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={back}
              disabled={step === 1 && activeScreen === 0}
              aria-disabled={(step === 1 && activeScreen === 0) || undefined}
            >
              {t("wizard.nav.back")}
            </Button>
            {isOptional ? (
              <Button variant="text" onClick={skip}>
                {t("wizard.nav.skip")}
              </Button>
            ) : null}
            {step < STEP_COUNT ? (
              <Button className="ms-auto" onClick={next} data-testid="next">
                {t("wizard.nav.next")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <PreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        draft={draft}
        uiLocale={uiLocale}
      />
      <SaveDialog
        key={saveKey}
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        onVerified={async () => {
          const saved = await save();
          if (saved && intent.current === "publish") await publishNow();
        }}
      />
    </div>
  );
}

/** Průvodce s překlady `wizard.*` pro prohlížeč. Načítá se jen v prohlížeči (koncept je v localStorage). */
/**
 * Výška pevného spodního pruhu do `--wizard-bar-height` (odsazení stránky i posunu za zaměřením v
 * `globals.css`): pruh se při zalomení a zvětšení písma zvětšuje, pevné odsazení by nestačilo.
 */
function trackBarHeight(bar: HTMLDivElement | null) {
  if (!bar) return;
  const root = document.documentElement;
  const update = () => root.style.setProperty("--wizard-bar-height", `${bar.offsetHeight}px`);
  update();
  const observer = new ResizeObserver(update);
  observer.observe(bar);
  return () => {
    observer.disconnect();
    root.style.removeProperty("--wizard-bar-height");
  };
}

export default function WizardApp(props: WizardAppProps) {
  return (
    <WizardI18nProvider locale={props.uiLocale} messages={props.messages}>
      <Wizard {...props} />
    </WizardI18nProvider>
  );
}
