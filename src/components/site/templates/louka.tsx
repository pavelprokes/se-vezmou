import { LoukaBackdrop, LoukaDivider } from "../ornaments";
import { ClassicSite, type TemplateProps } from "./classic";

/** Louka: výrazné patkové písmo, luční kvítí v úvodu a mezi sekcemi, zaoblené karty. */
export function LoukaSite(props: TemplateProps) {
  return (
    <ClassicSite
      {...props}
      decor={{ heroBackdrop: <LoukaBackdrop />, divider: <LoukaDivider /> }}
    />
  );
}
