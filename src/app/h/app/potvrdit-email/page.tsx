import type { Metadata } from "next";
import { BACKUP_CONFIRM_PATH, openBackupConfirm } from "@/auth/backup-confirm";
import { getUiLocale } from "@/auth/request";
import { getTranslator } from "@/i18n/load";
import { AuthShell } from "../shell";
import { BackupConfirmForm } from "./form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslator(await getUiLocale(), ["auth"]))("auth.backup.title") };
}

/**
 * Potvrzení záložního e-mailu odkazem ze zprávy „někdo vás uvedl jako záložní e-mail“. Bez přihlášení:
 * odkaz nese zapečetěnou svatbu a adresu. Potvrdí až odeslání formuláře (POST), ne otevření odkazu.
 */
export default async function BackupConfirmPage({
  searchParams,
}: PageProps<"/h/app/potvrdit-email">) {
  const t = await getTranslator(await getUiLocale(), ["auth"]);
  const raw = (await searchParams).t;
  const token = typeof raw === "string" ? raw : null;
  const opened = token ? openBackupConfirm(token) : null;

  if (!token || !opened) {
    return (
      <AuthShell
        locale={t.locale}
        path={BACKUP_CONFIRM_PATH}
        title={t("auth.backup.invalid.title")}
        intro={t("auth.backup.invalid.body")}
      >
        <p>{t("auth.backup.invalid.next")}</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      locale={t.locale}
      path={`${BACKUP_CONFIRM_PATH}?t=${encodeURIComponent(token)}`}
      title={t("auth.backup.title")}
      intro={t("auth.backup.body", { email: opened.email })}
    >
      <BackupConfirmForm
        token={token}
        labels={{
          submit: t("auth.backup.submit"),
          done: t("auth.backup.done"),
          invalid: t("auth.backup.invalid.body"),
          generic: t("auth.login.error.generic"),
        }}
      />
    </AuthShell>
  );
}
