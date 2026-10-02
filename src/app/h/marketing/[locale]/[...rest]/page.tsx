import { notFound } from "next/navigation";

// Každá neznámá cesta úvodní stránky skončí ve stránce 404 uvnitř kořenového layoutu.
export default function UnknownMarketingPath() {
  notFound();
}
