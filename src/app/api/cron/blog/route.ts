import { defaultCronHandler } from "@/lib/cron/default";
import { blogPublishJob } from "@/lib/cron/jobs/blog-publish";

/**
 * Zveřejnění naplánovaných článků blogu po půlnoci pražského času (src/lib/cron/jobs/blog-publish.ts).
 * Vercel Cron ji volá dvakrát denně podle `vercel.json` (22:01 a 23:01 UTC = půlnoc letního a zimního
 * času); běh, který připadne mimo půlnoc, nic nového nezveřejní a jen stránky načte. Na tarifu Hobby
 * je přesnost spuštění hodinová (do 59 minut), na Pro minutová.
 * Autorizace `Authorization: Bearer ${CRON_SECRET}`; parametr `dry_run` jen spočítá dnešní články.
 */
export const maxDuration = 60;

const handler = defaultCronHandler({ jobs: [blogPublishJob], allowTestClock: false });

export const GET = handler;
export const POST = handler;
