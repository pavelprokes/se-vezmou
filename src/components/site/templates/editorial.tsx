import { ClassicSite, type TemplateProps } from "./classic";

/** Editorial: klasická kostra bez dekoru (tenké linky a typografie jsou v `site.css`). */
export function EditorialSite(props: TemplateProps) {
  return <ClassicSite {...props} decor={{}} />;
}
