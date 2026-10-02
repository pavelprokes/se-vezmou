import "server-only";
import { cache } from "react";
import { opGetWedding } from "@/lib/db/rpc-ops";

/** Detail zakázky načtený jednou za požadavek (stránka i její metadata). */
export const loadWeddingDetail = cache((operatorId: string, weddingId: string) =>
  opGetWedding(operatorId, weddingId),
);
