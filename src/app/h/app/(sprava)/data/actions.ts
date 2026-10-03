"use server";

import { appHref } from "@/admin/paths";
import { after } from "next/server";
import { guarded } from "@/admin/guard";
import { deleteSite, type AccessContext, type DeleteSiteResult } from "@/admin/access/server";
import type { Guarded } from "@/admin/site/action-types";
import { appOrigin, currentHostConfig } from "@/auth/app-origin";
import { getHost, getUiLocale } from "@/auth/request";
import { endSession } from "@/auth/session";

/**
 * Smazání webu správcem (M7b). Web zmizí hned, údaje se trvale smažou po ochranné lhůtě (retenční
 * úloha, M10); všechna přihlášení se ukončí a ostatním správcům i na záložní adresu jde oznámení.
 */

async function context(): Promise<AccessContext> {
  const host = await getHost();
  const locale = await getUiLocale();
  return {
    locale,
    loginUrl: `${appOrigin(host, currentHostConfig())}${appHref("/prihlaseni", locale)}`,
    defer: (task) =>
      after(async () => {
        await task();
      }),
  };
}

export async function deleteSiteAction(confirmation: string): Promise<Guarded<DeleteSiteResult>> {
  const result = await guarded("smazání webu", async (session) =>
    deleteSite(
      { weddingId: session.weddingId, subjectId: session.subjectId, sessionId: session.sessionId },
      await context(),
      confirmation,
    ),
  );
  if ("status" in result && result.status === "deleted") {
    // relace je v databázi odvolaná; cookie se zruší, ať prohlížeč nezůstane s mrtvým tokenem
    await endSession().catch(() => undefined);
  }
  return result;
}
