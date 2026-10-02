import { CircleHelp } from "lucide-react";
import { ADMIN_PATHS, appHref } from "@/admin/paths";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/i18n/config";
import type { MessageKey } from "@/i18n/messages";
import { createTranslator } from "@/i18n/translator";

export const HELP_TOPICS = [
  "overview",
  "site",
  "publish",
  "history",
  "privacy",
  "gallery",
] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number];

export const HELP_KEYS: Record<HelpTopic, { title: MessageKey; body: MessageKey }> = {
  overview: { title: "admin.help.overview.title", body: "admin.help.overview.body" },
  site: { title: "admin.help.site.title", body: "admin.help.site.body" },
  publish: { title: "admin.help.publish.title", body: "admin.help.publish.body" },
  history: { title: "admin.help.history.title", body: "admin.help.history.body" },
  privacy: { title: "admin.help.privacy.title", body: "admin.help.privacy.body" },
  gallery: { title: "admin.help.gallery.title", body: "admin.help.gallery.body" },
};

/**
 * Nápověda k obrazovce hned pod nadpisem, na každé obrazovce na stejném místě (WCAG 3.2.6).
 * Nativní `<details>` funguje bez JavaScriptu a klávesnicí; rozbalená nápověda nic nepřekrývá.
 */
export function HelpBox({ locale, topic }: { locale: Locale; topic: HelpTopic }) {
  const t = createTranslator(locale);
  return (
    <details className="border-hairline bg-warm mt-4 rounded-2xl border" data-testid="help-box">
      <summary className="min-h-target text-ink flex cursor-pointer items-center gap-2 px-4 py-2 font-medium">
        <Icon icon={CircleHelp} />
        {t("admin.help.box")}
      </summary>
      <div className="flex flex-col gap-3 px-4 pt-1 pb-4">
        <p>{t(HELP_KEYS[topic].body)}</p>
        <p>
          <a
            href={appHref(ADMIN_PATHS.help, locale)}
            className="text-pine underline underline-offset-4"
          >
            {t("admin.help.more")}
          </a>
        </p>
      </div>
    </details>
  );
}
