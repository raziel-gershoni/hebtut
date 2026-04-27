import { z } from "zod";

const ServerSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(20),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(8),
  TELEGRAM_BOT_USERNAME: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_JWT_SECRET: z.string().min(20),
  APP_BASE_URL: z.string().url(),
  BOOTSTRAP_ADMIN_TG_USER_ID: z.coerce.number().int().positive(),
  DAILY_QUOTA_SECONDS: z.coerce.number().int().positive().default(300),
  CLAIM_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  DEFAULT_TZ: z.string().default("Asia/Jerusalem"),
  CRON_SECRET: z.string().min(8),
});

const PublicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

type ServerEnv = z.infer<typeof ServerSchema>;
type PublicEnv = z.infer<typeof PublicSchema>;

let cachedServer: ServerEnv | null = null;
let cachedPublic: PublicEnv | null = null;

// Lazy proxies — env is parsed on first access, not at module-load time.
// This lets `next build` and unit tests run without real env vars.
export const serverEnv: ServerEnv = new Proxy({} as ServerEnv, {
  get(_target, key: string) {
    if (!cachedServer) cachedServer = ServerSchema.parse(process.env);
    return cachedServer[key as keyof ServerEnv];
  },
});

export const publicEnv: PublicEnv = new Proxy({} as PublicEnv, {
  get(_target, key: string) {
    if (!cachedPublic) {
      cachedPublic = PublicSchema.parse({
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      });
    }
    return cachedPublic[key as keyof PublicEnv];
  },
});
