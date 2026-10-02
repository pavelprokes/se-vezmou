import { FileDown } from "lucide-react";
import type { Metadata } from "next";
import { loadAccess } from "@/admin/access/server";
import { ADMIN_PATHS, appHref } from "@/admin/paths";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import {
  AdminsPanel,
  BackupPanel,
  ConsentPanel,
  PinPanel,
} from "@/components/admin/guests/access-panels";
import { AdminI18nProvider } from "@/components/admin/i18n";
import { pickAdminMessages } from "@/components/admin/messages";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { createTranslator } from "@/i18n/translator";
import {
  addAdminAction,
  changePinAction,
  grantAccessAction,
  removeAdminAction,
  revokeAccessAction,
  setBackupEmailAction,
  setGuestPinEnabledAction,
} from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: createTranslator(await getUiLocale())("admin.guests.nav.access") };
}

/**
 * Přístup (FR-PRIV-2, OQ-53): kdo smí spravovat web, záložní e-mail, PIN správy a PIN hostů,
 * souhlas s nahlédnutím provozovatele a PDF oznámení k tisku. Každá změna přístupu posílá oznámení
 * ostatním správcům a na záložní adresu.
 */
export default async function AccessPage({ searchParams }: PageProps<"/h/app/pristup">) {
  const session = await requireSession();
  const locale = await getUiLocale();
  const t = createTranslator(locale);
  const params = await searchParams;
  const view = await loadAccess(session);
  const published = view.status === "published" && view.slug !== null;

  return (
    <AdminI18nProvider locale={locale} messages={pickAdminMessages(locale)}>
      <AdminFrame
        locale={locale}
        path={ADMIN_PATHS.access}
        active="access"
        title={t("admin.guests.nav.access")}
        intro={t("admin.guests.access.intro")}
        help="access"
      >
        <div className="flex flex-col gap-6">
          {params.ulozeno ? (
            <p role="status" className="text-ink font-medium">
              {t("admin.guests.access.saved")}
            </p>
          ) : null}
          <AdminsPanel
            view={view}
            locale={locale}
            actions={{ addAdmin: addAdminAction, removeAdmin: removeAdminAction }}
          />
          <BackupPanel view={view} actions={{ setBackupEmail: setBackupEmailAction }} />
          <PinPanel
            view={view}
            actions={{ changePin: changePinAction, setGuestPinEnabled: setGuestPinEnabledAction }}
          />

          <Card as="section" aria-labelledby="announce-heading">
            <h2 id="announce-heading" className="flex items-center gap-2 text-2xl font-medium">
              <Icon icon={FileDown} />
              {t("admin.guests.access.announce.title")}
            </h2>
            <p className="text-muted mt-2 max-w-prose">{t("admin.guests.access.announce.intro")}</p>
            {published ? (
              <form
                method="post"
                action={appHref("/vytvorit/oznameni", locale)}
                className="mt-4 flex flex-col gap-4"
              >
                <Field
                  name="pin"
                  label={t("admin.guests.access.announce.pin")}
                  hint={t("admin.guests.access.announce.pinHint")}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={16}
                />
                <div>
                  <Button type="submit" variant="secondary">
                    {t("admin.guests.access.announce.submit")}
                  </Button>
                </div>
              </form>
            ) : (
              <p className="mt-3">{t("admin.guests.access.announce.unpublished")}</p>
            )}
          </Card>

          <ConsentPanel
            view={view}
            locale={locale}
            actions={{ grant: grantAccessAction, revoke: revokeAccessAction }}
          />
        </div>
      </AdminFrame>
    </AdminI18nProvider>
  );
}
