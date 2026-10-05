import { ViniceCrest, ViniceDivider } from "../ornaments";
import { ClassicSite, type TemplateProps } from "./classic";

/** Vinice: Garamond, hrozen nad jmény, úponek révy mezi sekcemi a jemný rám úvodu. */
export function ViniceSite(props: TemplateProps) {
  return (
    <ClassicSite {...props} decor={{ heroCrest: <ViniceCrest />, divider: <ViniceDivider /> }} />
  );
}
