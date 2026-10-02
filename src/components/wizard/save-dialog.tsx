"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import {
  requestSaveCodeAction,
  verifySaveCodeAction,
  type RequestSaveCodeResult,
  type VerifySaveCodeResult,
} from "@/app/h/app/vytvorit/actions";
import { useT, type WizardKey } from "./i18n";

type Stage = "emails" | "code" | "saving";

type EmailError =
  Extract<RequestSaveCodeResult, { status: "invalid" }>["field"] | "generic" | "limited";
type CodeError = Exclude<VerifySaveCodeResult["status"], "verified"> | "none";

/**
 * První uložení: e-mail správce a záložní e-mail (povinný), potom kód z e-mailu. E-mail se vyžádá
 * až tady, ne dřív (FR-WZ-2); kód ověří e-mail dřív, než se rezervuje adresa. Pole kódu je
 * obyčejné pole, jde do něj vložit ze schránky (WCAG 3.3.8), a údaje se nikdy nezadávají dvakrát
 * (3.3.7). Dialog je nativní `<dialog>`: zachytí zaměření a zavře se klávesou Esc.
 */
export function SaveDialog({
  open,
  onClose,
  onVerified,
}: {
  open: boolean;
  onClose: () => void;
  /** E-mail je ověřený (nebo už je správce přihlášený): volající provede uložení. */
  onVerified: () => Promise<void>;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const [stage, setStage] = useState<Stage>("emails");
  const [email, setEmail] = useState("");
  const [backup, setBackup] = useState("");
  const [code, setCode] = useState("");
  const [emailError, setEmailError] = useState<EmailError | null>(null);
  const [codeError, setCodeError] = useState<CodeError>("none");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    setPending(true);
    setEmailError(null);
    const result = await requestSaveCodeAction({ email, backupEmail: backup });
    setPending(false);
    switch (result.status) {
      case "sent":
        setCode("");
        setCodeError("none");
        setStage("code");
        return;
      case "already_signed_in":
        setStage("saving");
        await onVerified();
        return;
      case "invalid":
        setEmailError(result.field);
        document
          .getElementById(
            result.field === "backupEmail" || result.field === "same" ? "wz-backup" : "wz-email",
          )
          ?.focus();
        return;
      case "limited":
        setEmailError("limited");
        return;
      case "error":
        setEmailError("generic");
        return;
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setCodeError("none");
    const result = await verifySaveCodeAction(code);
    if (result.status === "verified") {
      setStage("saving");
      await onVerified();
      setPending(false);
      return;
    }
    setPending(false);
    setCodeError(result.status);
    document.getElementById("wz-code")?.focus();
  }

  const emailMessage = (field: "email" | "backup"): string | undefined => {
    if (field === "email" && emailError === "email") return t("wizard.save.error.email");
    if (field === "backup" && emailError === "backupEmail") return t("wizard.save.error.backup");
    if (field === "backup" && emailError === "same") return t("wizard.save.error.same");
    return undefined;
  };
  const formMessage =
    emailError === "limited"
      ? t("wizard.save.error.limited")
      : emailError === "generic"
        ? t("wizard.save.error.generic")
        : undefined;

  return (
    <dialog
      ref={ref}
      aria-labelledby="wz-save-title"
      onClose={onClose}
      className="bg-parchment text-ink border-hairline m-auto w-[min(34rem,calc(100vw-2rem))] rounded-2xl border p-6 backdrop:bg-black/70"
    >
      <h2 id="wz-save-title" className="text-2xl font-medium">
        {stage === "code" ? t("wizard.save.code.title") : t("wizard.save.title")}
      </h2>

      {stage === "emails" ? (
        <form onSubmit={sendCode} noValidate className="mt-4 flex flex-col gap-5">
          <p>{t("wizard.save.intro")}</p>
          <FormAlert>{formMessage}</FormAlert>
          <Field
            id="wz-email"
            type="email"
            name="email"
            label={t("wizard.save.email.label")}
            hint={t("wizard.save.email.hint")}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={emailMessage("email")}
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
          <Field
            id="wz-backup"
            type="email"
            name="backupEmail"
            label={t("wizard.save.backup.label")}
            hint={t("wizard.save.backup.hint")}
            value={backup}
            onChange={(event) => setBackup(event.target.value)}
            error={emailMessage("backup")}
            autoComplete="off"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending} aria-disabled={pending || undefined}>
              {t("wizard.save.send")}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {t("wizard.save.cancel")}
            </Button>
          </div>
        </form>
      ) : null}

      {stage === "code" ? (
        <form onSubmit={verify} noValidate className="mt-4 flex flex-col gap-5">
          <p>{t("wizard.save.code.intro", { email })}</p>
          <FormAlert>
            {codeError === "limited" || codeError === "error" || codeError === "expired"
              ? t(`wizard.save.code.error.${codeError}` as WizardKey)
              : undefined}
          </FormAlert>
          <Field
            id="wz-code"
            type="text"
            name="code"
            label={t("wizard.save.code.label")}
            hint={t("wizard.save.code.hint")}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            error={
              codeError === "invalid" || codeError === "format"
                ? t(`wizard.save.code.error.${codeError}` as WizardKey)
                : undefined
            }
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9 \-]*"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending} aria-disabled={pending || undefined}>
              {t("wizard.save.code.submit")}
            </Button>
            <Button variant="text" onClick={() => void sendCode()} disabled={pending}>
              {t("wizard.save.code.resend")}
            </Button>
            <Button variant="text" onClick={() => setStage("emails")}>
              {t("wizard.save.code.change")}
            </Button>
          </div>
        </form>
      ) : null}

      {stage === "saving" ? (
        <p role="status" className="mt-4">
          {t("wizard.save.saving")}
        </p>
      ) : null}
    </dialog>
  );
}
