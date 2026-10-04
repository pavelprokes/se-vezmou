import { robotsResponse, tenantRobots } from "@/seo/robots";

/** Web páru: náhledy sdílených odkazů povolené, indexace ne (viz `tenantRobots`). */
export function GET() {
  return robotsResponse(tenantRobots());
}
