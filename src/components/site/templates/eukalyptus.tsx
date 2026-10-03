import { EucalyptusDivider, EucalyptusLeaves } from "../ornaments";
import { ClassicSite, type TemplateProps } from "./classic";

/** Eukalyptus: klasická kostra s větvičkami v úvodu a oddělovačem s lístky. */
export function EukalyptusSite(props: TemplateProps) {
  return (
    <ClassicSite
      {...props}
      decor={{ heroBackdrop: <EucalyptusLeaves />, divider: <EucalyptusDivider /> }}
    />
  );
}
