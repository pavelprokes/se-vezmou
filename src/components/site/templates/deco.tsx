import { DecoCrest, DecoDivider } from "../ornaments";
import { ClassicSite, type TemplateProps } from "./classic";

/** Deco: art deco s vějířem nad jmény, stupňovitou linkou a verzálkami s prostrkáním. */
export function DecoSite(props: TemplateProps) {
  return <ClassicSite {...props} decor={{ heroCrest: <DecoCrest />, divider: <DecoDivider /> }} />;
}
