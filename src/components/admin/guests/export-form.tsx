import { Button } from "@/components/ui/button";
import { Checkbox, Radio } from "@/components/ui/choice";
import { Fieldset } from "@/components/ui/field";
import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";

/**
 * Export hostů a odpovědí (FR-LC-2): CSV nebo Excel. Obyčejný formulář (POST na chráněnou cestu,
 * funguje i bez JavaScriptu). Dieta a alergie jsou zdravotní údaje, proto jen na výslovné zaškrtnutí;
 * jejich vydání se eviduje.
 */
export async function ExportForm({ action, locale }: { action: string; locale: Locale }) {
  const t = await getTranslator(locale, ["admin.guests"]);
  return (
    <form method="post" action={action} className="flex flex-col gap-4">
      <Fieldset legend={t("admin.guests.export.format")}>
        <div className="flex flex-wrap gap-x-6">
          <Radio name="format" value="xlsx" label={t("admin.guests.export.xlsx")} defaultChecked />
          <Radio name="format" value="csv" label={t("admin.guests.export.csv")} />
        </div>
      </Fieldset>
      <div>
        <Checkbox name="health" value="1" label={t("admin.guests.export.health")} />
        <p className="text-muted ml-9 text-sm">{t("admin.guests.export.healthHint")}</p>
      </div>
      <div>
        <Button type="submit">{t("admin.guests.export.submit")}</Button>
      </div>
    </form>
  );
}
