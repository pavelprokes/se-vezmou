import { Lock } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { buildSpayd } from "@/site/payment";
import type { BlockOf } from "@/site/types";
import type { SiteCtx } from "../context";
import { giftsModel } from "../models";
import { PinGate, UnlockedRegion } from "../pin-gate";
import { pinGateLabels } from "../pin-labels";
import { ForeignPayment } from "./foreign-payment";
import { GiftRegistrySection } from "./gift-registry-section";
import { PaymentQr } from "./payment-qr";
import { Paragraphs, Section } from "./section";

/**
 * Dary (číslo účtu a QR platba bez pevné částky) jsou citlivý blok za PINem (FR-PRIV-2).
 * Obsah se vykreslí jen s příznakem `sensitiveUnlocked` a dostupnými citlivými údaji;
 * jinak je vidět jen formulář PINu (`PinGate`, ověřuje server). Bez PINu se citlivá data
 * nedostanou ani do HTML, ani do RSC payloadu: komponenta je nedostává.
 * Bez čísla účtu (`payment: false`) je sekce jen veřejný úvodní text.
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
  const gifts = giftsModel(ctx);

  return (
    <Section block={block} ctx={ctx} tone={tone}>
      {!block.data.payment ? (
        // Bez čísla účtu: jen úvodní text páru, veřejně a bez PINu
        <Paragraphs value={block.data.intro} ctx={ctx} className="site-lead" />
      ) : gifts ? (
        <UnlockedRegion label={t("site.pin.unlocked")} unlockKey="gifts">
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
              <ForeignPayment gifts={gifts} ctx={ctx} facts="site-facts" />
            </div>
            <figure className="site-qr-figure">
              <PaymentQr
                payload={buildSpayd({ iban: gifts.iban, message: gifts.paymentMessage })}
                label={t("site.gifts.qrLabel", { account: gifts.account })}
              />
              <figcaption className="site-muted">{t("site.gifts.qrHint")}</figcaption>
            </figure>
          </div>
        </UnlockedRegion>
      ) : ctx.sensitiveUnlocked && ctx.sensitive !== null ? (
        // Host je po PINu, ale údaje o daru nejsou k dispozici: žádný nový formulář PINu (smyčka)
        <p className="site-lead">{t("site.gifts.unavailable")}</p>
      ) : (
        <div className="site-gate">
          <Icon icon={Lock} size={28} />
          <PinGate labels={pinGateLabels(t, "gifts")} locale={ctx.locale} unlockKey="gifts" />
        </div>
      )}
      <GiftRegistrySection
        ctx={ctx}
        gateShown={
          block.data.payment && !gifts && !(ctx.sensitiveUnlocked && ctx.sensitive !== null)
        }
      />
    </Section>
  );
}
