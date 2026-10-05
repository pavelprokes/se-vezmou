import { StatekDivider } from "../ornaments";
import { ClassicSite, type TemplateProps } from "./classic";

/** Statek: klasická kostra s měkkým patkovým písmem, klasem jako oddělovačem a prošívanými kartami. */
export function StatekSite(props: TemplateProps) {
  return <ClassicSite {...props} decor={{ divider: <StatekDivider /> }} />;
}
