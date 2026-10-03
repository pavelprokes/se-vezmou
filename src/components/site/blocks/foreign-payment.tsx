import type { SensitiveContent } from "@/site/types";
import type { SiteCtx } from "../context";
import { CopyButton } from "../copy-button";

/** IBAN po čtveřicích pro čitelnost; kopíruje se tvar bez mezer. */
function groupIban(iban: string): string {
  return iban.replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ");
}

/**
 * Údaje pro převod ze zahraničí (jen anglická verze): zahraniční bankovní aplikace QR platbu
 * zpravidla nečtou, takže příjemce, IBAN, BIC a zpráva jsou i jako text s tlačítkem „Kopírovat“.
 * `facts` je třída seznamu údajů šablony (`site-facts`, `eu-facts`).
 */
export function ForeignPayment({
  gifts,
  ctx,
  facts,
}: {
  gifts: NonNullable<SensitiveContent["gifts"]>;
  ctx: SiteCtx;
  facts: string;
}) {
  if (ctx.locale !== "en") return null;
  const { t } = ctx;
  const rows: { key: string; label: string; shown: string; copy: string }[] = [];
  if (gifts.holder) {
    rows.push({
      key: "holder",
      label: t("site.gifts.recipient"),
      shown: gifts.holder,
      copy: gifts.holder,
    });
  }
  rows.push({
    key: "iban",
    label: t("site.gifts.iban"),
    shown: groupIban(gifts.iban),
    copy: gifts.iban.replace(/\s+/g, ""),
  });
  if (gifts.bic) {
    rows.push({ key: "bic", label: t("site.gifts.bic"), shown: gifts.bic, copy: gifts.bic });
  }
  if (gifts.paymentMessage) {
    rows.push({
      key: "message",
      label: t("site.gifts.message"),
      shown: gifts.paymentMessage,
      copy: gifts.paymentMessage,
    });
  }
  return (
    <section aria-labelledby="gifts-foreign">
      <h3 id="gifts-foreign" className="site-h3">
        {t("site.gifts.foreignTitle")}
      </h3>
      <p className="site-muted">{t("site.gifts.foreignHint")}</p>
      <dl className={facts}>
        {rows.map((row) => (
          <div key={row.key}>
            <dt>{row.label}</dt>
            <dd>
              <span className="site-account">{row.shown}</span>{" "}
              <CopyButton
                value={row.copy}
                text={t("site.gifts.copy")}
                label={t("site.gifts.copyLabel", { field: row.label })}
                copiedLabel={t("site.gifts.copied")}
              />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
