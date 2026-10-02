import type { Metadata } from "next";
import { ADMIN_PATHS } from "@/admin/paths";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { HELP_KEYS, HELP_TOPICS } from "@/components/admin/help";
import { Card } from "@/components/ui/card";
import { createTranslator } from "@/i18n/translator";

export async function generateMetadata(): Promise<Metadata> {
  return { title: createTranslator(await getUiLocale())("admin.help.title") };
}

/** Přehled všech témat nápovědy; stručná nápověda je navíc na každé obrazovce pod nadpisem. */
export default async function HelpPage() {
  await requireSession();
  const locale = await getUiLocale();
  const t = createTranslator(locale);
  return (
    <AdminFrame
      locale={locale}
      path={ADMIN_PATHS.help}
      active="help"
      title={t("admin.help.title")}
      intro={t("admin.help.intro")}
      help="overview"
    >
      <div className="flex flex-col gap-4">
        {HELP_TOPICS.map((topic) => (
          <Card as="section" key={topic} aria-labelledby={`help-${topic}`}>
            <h2 id={`help-${topic}`} className="text-2xl font-medium">
              {t(HELP_KEYS[topic].title)}
            </h2>
            <p className="mt-2">{t(HELP_KEYS[topic].body)}</p>
          </Card>
        ))}
        <p className="text-muted">{t("admin.help.contact")}</p>
      </div>
    </AdminFrame>
  );
}
