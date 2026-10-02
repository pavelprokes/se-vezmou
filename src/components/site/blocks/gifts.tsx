import { Lock } from "lucide-react";
import qrcode from "qrcode-generator";
import { Icon } from "@/components/ui/icon";
import { buildSpayd } from "@/site/payment";
import type { BlockOf } from "@/site/types";
import type { SiteCtx } from "../context";
import { PinGate } from "../pin-gate";
import { Paragraphs, Section } from "./section";

/** QR kód jako inline SVG (černá na bílé s tichou zónou, aby šel načíst v každé paletě). */
export function PaymentQr({ payload, label }: { payload: string; label: string }) {
  const qr = qrcode(0, "M");
  qr.addData(payload);
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 4;
  let path = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  const size = count + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      className="site-qr"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

/**
 * Dary (číslo účtu a QR platba bez pevné částky) jsou citlivý blok za PINem (FR-PRIV-2).
 * Obsah se vykreslí jen s příznakem `sensitiveUnlocked` a dostupnými citlivými údaji;
 * jinak je vidět jen zástupný formulář PINu bez logiky (TODO(M8-7): ověření PINu).
 * V režimu poděkování po svatbě se blok nevykresluje vůbec (`renderableBlocks`).
 */
export function Gifts({
  block,
  ctx,
  tone,
}: {
  block: BlockOf<"gifts">;
  ctx: SiteCtx;
  tone: "bg" | "surface";
}) {
  const { t } = ctx;
  const gifts = ctx.sensitiveUnlocked ? ctx.sensitive?.gifts : null;

  return (
    <Section block={block} ctx={ctx} tone={tone}>
      {gifts ? (
        <div className="site-gifts">
          <div>
            <Paragraphs value={block.data.intro} ctx={ctx} className="site-lead" />
            <dl className="site-facts">
              <div>
                <dt>{t("site.gifts.account")}</dt>
                <dd className="site-account">{gifts.account}</dd>
              </div>
              {gifts.holder ? (
                <div>
                  <dt>{t("site.gifts.holder")}</dt>
                  <dd>{gifts.holder}</dd>
                </div>
              ) : null}
            </dl>
          </div>
          <figure className="site-qr-figure">
            <PaymentQr
              payload={buildSpayd({ iban: gifts.iban, message: gifts.paymentMessage })}
              label={t("site.gifts.qrLabel", { account: gifts.account })}
            />
            <figcaption className="site-muted">{t("site.gifts.qrHint")}</figcaption>
          </figure>
        </div>
      ) : (
        <div className="site-gate">
          <Icon icon={Lock} size={28} />
          <PinGate
            title={t("site.gifts.gateTitle")}
            body={t("site.gifts.gateBody")}
            label={t("site.gifts.pinLabel")}
            submit={t("site.gifts.pinSubmit")}
          />
        </div>
      )}
    </Section>
  );
}
