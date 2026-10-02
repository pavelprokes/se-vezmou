import { marketingRobots, robotsResponse } from "@/seo/robots";
import { siteUrl } from "@/lib/site";

// Proxy mapuje `/robots.txt` na tohoto handlera (soubor `robots.ts` funguje jen v kořeni `app`).
export function GET() {
  return robotsResponse(marketingRobots(siteUrl));
}
