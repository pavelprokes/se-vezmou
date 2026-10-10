import { Lock } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import type { SiteCtx } from "../context";
import { GiftRegistryList, type RegistryEntry, type RegistryLabels } from "../gift-registry";
import { PinGate } from "../pin-gate";
import { pinGateLabels } from "../pin-labels";

/**
 * Seznam věcných darů pod obsahem sekce Dary (všechny šablony). S PINem hostů se bez relace ukáže jen
 * formulář PINu (pokud ho sekce už neukazuje kvůli číslu účtu); dary se pak do stránky vůbec nedostanou.
 */
export function GiftRegistrySection({
  ctx,
  gateShown,
  className,
}: {
  ctx: SiteCtx;
  /** Sekce už ukazuje formulář PINu (číslo účtu); druhý by byl zbytečný. */
  gateShown: boolean;
  className?: string;
}) {
  const { t, registry } = ctx;
  if (!registry) return null;
  if (registry.locked) {
    if (gateShown) return null;
    return (
      <div className={className ? `${className} site-gate` : "site-gate"}>
        <Icon icon={Lock} size={28} />
        <PinGate labels={pinGateLabels(t, "registry")} locale={ctx.locale} unlockKey="gifts" />
      </div>
    );
  }
  if (registry.items.length === 0) return null;

  const labels: RegistryLabels = {
    title: t("site.registry.title"),
    intro: t("site.registry.intro"),
    shop: t("site.registry.shop"),
    newTab: t("site.registry.newTab"),
    free: t("site.registry.free"),
    taken: t("site.registry.taken"),
    mine: t("site.registry.mine"),
    reserve: t("site.registry.reserve"),
    reserveLabel: t("site.registry.reserveLabel", { gift: "{gift}" }),
    confirm: t("site.registry.confirm"),
    cancel: t("site.registry.cancel"),
    name: t("site.registry.name"),
    nameHint: t("site.registry.nameHint"),
    unreserve: t("site.registry.unreserve"),
    unreserveLabel: t("site.registry.unreserveLabel", { gift: "{gift}" }),
    reserved: t("site.registry.reserved", { gift: "{gift}" }),
    unreserved: t("site.registry.unreserved", { gift: "{gift}" }),
    errors: {
      taken: t("site.registry.error.taken"),
      locked: t("site.registry.error.locked"),
      closed: t("site.registry.error.closed"),
      limited: t("site.registry.error.limited"),
      error: t("site.registry.error.generic"),
    },
  };
  const localize: Record<string, Pick<RegistryEntry, "title" | "titleLang" | "description">> = {};
  const entries: RegistryEntry[] = registry.items.map((item) => {
    const text = {
      title: ctx.text(item.title),
      titleLang: ctx.lang(item.title),
      description: ctx.text(item.description),
    };
    localize[item.id] = text;
    return {
      id: item.id,
      ...text,
      url: item.url,
      price: item.price,
      reserved: item.reserved,
      mine: item.mine,
    };
  });
  return (
    <div className={className}>
      <GiftRegistryList labels={labels} locale={ctx.locale} initial={entries} localize={localize} />
    </div>
  );
}
