import { ClassicSite, type TemplateProps } from "./classic";

/** Modern: klasická kostra bez dekoru (silné linky a velké písmo jsou v `site.css`). */
export function ModernSite(props: TemplateProps) {
  return <ClassicSite {...props} decor={{}} />;
}
