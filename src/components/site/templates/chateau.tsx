import { ChateauDivider, Monogram } from "../ornaments";
import { ClassicSite, type TemplateProps } from "./classic";

/** Chateau: klasická kostra s monogramem nad jmény a oddělovačem s kosočtvercem. */
export function ChateauSite(props: TemplateProps) {
  const { a, b } = props.ctx.content.partners;
  return (
    <ClassicSite
      {...props}
      decor={{ heroCrest: <Monogram a={a} b={b} />, divider: <ChateauDivider /> }}
    />
  );
}
