import { CircleHelp } from "lucide-react";
import { ADMIN_PATHS, GUIDE_PATH, appHref } from "@/admin/paths";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/i18n/config";
import type { NamespaceKey } from "@/i18n/messages";
import { getTranslator } from "@/i18n/load";

export const HELP_TOPICS = [
  "overview",
  "site",
  "publish",
  "history",
  "privacy",
  "gallery",
  "guests",
  "import",
  "responses",
  "rsvp",
  "access",
  "data",
] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number];

type HelpKey = NamespaceKey<"admin" | "admin.guests">;

export const HELP_KEYS: Record<HelpTopic, { title: HelpKey; body: HelpKey }> = {
  overview: { title: "admin.help.overview.title", body: "admin.help.overview.body" },
  site: { title: "admin.help.site.title", body: "admin.help.site.body" },
  publish: { title: "admin.help.publish.title", body: "admin.help.publish.body" },
  history: { title: "admin.help.history.title", body: "admin.help.history.body" },
  privacy: { title: "admin.help.privacy.title", body: "admin.help.privacy.body" },
  gallery: { title: "admin.help.gallery.title", body: "admin.help.gallery.body" },
  guests: { title: "admin.guests.help.guests.title", body: "admin.guests.help.guests.body" },
  import: { title: "admin.guests.help.import.title", body: "admin.guests.help.import.body" },
  responses: {
    title: "admin.guests.help.responses.title",
    body: "admin.guests.help.responses.body",
  },
  rsvp: { title: "admin.guests.help.rsvp.title", body: "admin.guests.help.rsvp.body" },
  access: { title: "admin.guests.help.access.title", body: "admin.guests.help.access.body" },
  data: { title: "admin.guests.help.data.title", body: "admin.guests.help.data.body" },
};

/**
 * Nápověda k obrazovce hned pod nadpisem, na každé obrazovce na stejném místě (WCAG 3.2.6).
 * Nativní `<details>` funguje bez JavaScriptu a klávesnicí; rozbalená nápověda nic nepřekrývá.
 */
export async function HelpBox({ locale, topic }: { locale: Locale; topic: HelpTopic }) {
  const t = await getTranslator(locale, ["admin", "admin.guests"]);
  return (
    <details
      className="border-hairline bg-warm mt-4 rounded-2xl border print:hidden"
      data-testid="help-box"
    >
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
        <p>
          <a href={appHref(GUIDE_PATH, locale)} className="text-pine underline underline-offset-4">
            {t("admin.help.guide")}
          </a>
        </p>
      </div>
    </details>
  );
}
