import { closedRobots, robotsResponse } from "@/seo/robots";

export function GET() {
  return robotsResponse(closedRobots());
}
