import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url().default("https://se-vezmou.cz"),
});

// Při buildu v CI lze validaci přeskočit pomocí SKIP_ENV_VALIDATION=1.
export const env = process.env.SKIP_ENV_VALIDATION
  ? (process.env as unknown as z.infer<typeof schema>)
  : schema.parse({
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
    });
