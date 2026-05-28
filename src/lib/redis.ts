import { Redis } from "@upstash/redis";
import { serverEnv } from "./env";

let cached: Redis | null = null;

/**
 * Lazy Upstash Redis client. Same pattern as our other env-backed
 * services — env access is lazy via the serverEnv Proxy so build-time
 * doesn't need the secrets, and we instantiate once per process.
 *
 * Primary use today: TG webhook update_id idempotency via SETNX. See
 * src/app/api/webhook/route.ts.
 */
export function getRedis(): Redis {
  if (cached) return cached;
  cached = new Redis({
    url: serverEnv.UPSTASH_REDIS_REST_URL,
    token: serverEnv.UPSTASH_REDIS_REST_TOKEN,
  });
  return cached;
}
