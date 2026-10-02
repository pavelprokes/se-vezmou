import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url().default("https://se-vezmou.cz"),
  // Adresa průvodce a správy (`app.`). Úvodní stránka na ni odkazuje a předává jména párů.
  NEXT_PUBLIC_APP_URL: z.url().default("https://app.se-vezmou.cz"),

  // Supabase (volitelné, dokud není projekt založen)
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // AWS SES
  AWS_REGION: z.string().min(1).optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),

  // Administrace: e-maily oddělené čárkou, kterým je povolen přístup po Google loginu
  ADMIN_EMAILS: z.string().optional(),
});

// Prázdné řetězce (např. z .env) bereme jako nenastavené.
const raw = Object.fromEntries(
  Object.keys(schema.shape).map((key) => [key, process.env[key] || undefined]),
);

export const env = schema.parse(raw);
