import { z } from "zod";

/**
 * Parse the comma-separated `BOOTSTRAP_ADMIN_TG_USER_IDS` env value into a
 * deduped, ordered list of positive Telegram user ids. Throws on bad input.
 * Exported so it can be unit-tested independently of the env Proxy.
 */
export function parseAdminIds(raw: string): number[] {
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error("BOOTSTRAP_ADMIN_TG_USER_IDS is empty");
  const ids: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`BOOTSTRAP_ADMIN_TG_USER_IDS: "${p}" is not a positive integer`);
    }
    ids.push(n);
  }
  return Array.from(new Set(ids));
}

const ServerSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(20),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(8),
  TELEGRAM_BOT_USERNAME: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  // Single-line JWK JSON of the ES256 (or RS256) private signing key whose public
  // half has been imported into Supabase Dashboard → JWT Keys.
  // Generate with: `pnpm exec supabase gen signing-key --algorithm ES256`
  SUPABASE_JWT_PRIVATE_KEY: z.string().refine(
    (s) => {
      try {
        const k = JSON.parse(s) as { kty?: string; kid?: string; alg?: string };
        return !!(k.kty && k.kid && k.alg);
      } catch {
        return false;
      }
    },
    { message: "must be a JWK JSON string with kty, kid, alg fields" },
  ),
  APP_BASE_URL: z.string().url(),
  // Comma-separated list of Telegram numeric user ids that should be auto-promoted
  // to `admin` on first webhook hit. Accepts a single id or many (e.g. "12345" or
  // "12345,67890"). Whitespace tolerated.
  BOOTSTRAP_ADMIN_TG_USER_IDS: z.string().min(1).transform((s, ctx) => {
    try {
      return parseAdminIds(s);
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: (e as Error).message,
      });
      return z.NEVER;
    }
  }),
  DAILY_QUOTA_SECONDS: z.coerce.number().int().positive().default(300),
  // Slack the daily quota by this many seconds. Anything within
  // [DAILY_QUOTA, DAILY_QUOTA + OVERFLOW_GRACE_SECONDS] is still accepted
  // today; the part beyond DAILY_QUOTA is debited against tomorrow.
  OVERFLOW_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(60),
  CLAIM_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  // Interval (in seconds) between heartbeat pings from tutor's Mini App.
  // Each ping inserts one 'active' event spanning this duration.
  WORK_HEARTBEAT_CADENCE_SEC: z.coerce.number().int().positive().default(30),
  // Telegram Stars price for one 30-day subscription period. Stars are 1:1
  // with USD-cents at TG's rate; 100 stars ≈ $1.50 at the time of writing.
  // Tune via env without a deploy of code changes.
  MONTHLY_SUBSCRIPTION_STARS: z.coerce.number().int().positive().default(100),
  DEFAULT_TZ: z.string().default("Asia/Jerusalem"),
  CRON_SECRET: z.string().min(8),
  // Google AI Studio (Gemini API) key. Used by src/server/transcribe.ts to
  // auto-transcribe teacher voice / video_note replies. Paid-tier key only
  // — the free tier trains on submitted content, which we don't want for
  // student/teacher audio.
  //
  // OPTIONAL: when unset, transcription gracefully returns null and the
  // student gets the "could not transcribe" follow-up message. We don't
  // hard-require because zod validates the whole env on first serverEnv
  // access — a missing key here would otherwise break unrelated routes
  // (cron, webhooks, etc.).
  GEMINI_API_KEY: z.string().min(1).optional(),
  // Upstash Redis (REST). Used by the TG webhook to dedup retries by
  // `update_id` — without this, slow handlers (transcribe/translate
  // can run 30-50s in-band) get re-fired by TG's ~30s retry timeout
  // and the student receives the relayed voice/video multiple times.
  // Free tier covers our volume easily (10k commands/day).
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(20),
  // Cloudflare R2 (S3-compatible) for student media — private bucket + presigned
  // URLs. OPTIONAL on purpose: zod parses the whole schema on first serverEnv
  // access, so requiring these would break every route until they're set. When
  // unset, the R2 client throws at its call site and media degrades to the
  // /api/media proxy fallback instead of taking down unrelated routes.
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET: z.string().min(1).optional(),
  R2_MEDIA_LIBRARY_BUCKET: z.string().min(1).optional(),
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
