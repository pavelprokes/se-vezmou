import type { Metadata } from "next";
import { NotFoundContent, notFoundMetadata } from "@/components/not-found-content";

export function generateMetadata(): Metadata {
  return notFoundMetadata("cs");
}

export default function AdminNotFound() {
  return <NotFoundContent locale="cs" />;
}
