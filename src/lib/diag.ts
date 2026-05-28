/**
 * Client-side diagnostic reporter. Fires a fire-and-forget POST to
 * /api/diag/client-error with a structured payload that includes the
 * failure step, the error, file/context info, and the device/browser
 * env (UA, TG WebApp platform, viewport, DPR).
 *
 * Use at every meaningful client-side failure point in the media flow
 * (compression, upload, register, preview load) so production failures
 * on any platform — iPhone TGMA, Android TGMA, TG Desktop, TG Web —
 * leave a queryable audit_events row instead of dying silently in the
 * browser console.
 *
 * Diagnostics MUST NOT throw back into the failing path: the helper
 * catches its own errors and returns without re-raising.
 */

export type ClientMediaErrorStep =
  | "probe"
  | "compress"
  | "upload-presign"
  | "upload-tus"
  | "register"
  | "send"
  | "preview-load";

export interface ClientMediaErrorPayload {
  step: ClientMediaErrorStep;
  err: { message: string; name?: string; stack_top?: string };
  ctx: Record<string, unknown>;
  env: Record<string, unknown>;
}

interface ReportCtx {
  size_bytes?: number;
  mime?: string;
  name?: string;
  ffmpeg_log_tail?: string[];
  library_id?: number;
  message_id?: number;
  storage_path?: string;
  [k: string]: unknown;
}

let lastSentAt = 0;
const RATE_LIMIT_MS = 10_000;

export async function reportClientMediaError(
  step: ClientMediaErrorStep,
  err: unknown,
  ctx: ReportCtx = {},
  jwt?: string,
): Promise<void> {
  // Per-tab rate limit so a tight error loop doesn't spam the table.
  // The server has its own per-(actor, step) debounce as a backstop.
  const now = Date.now();
  if (now - lastSentAt < RATE_LIMIT_MS) return;
  lastSentAt = now;

  const env = captureEnv();
  const errPayload =
    err instanceof Error
      ? {
          message: err.message || err.name || "Error",
          name: err.name,
          stack_top: err.stack?.split("\n").slice(0, 3).join(" | "),
        }
      : {
          message: typeof err === "string" ? err : "non-Error rejection",
          name: typeof err,
        };

  const payload: ClientMediaErrorPayload = { step, err: errPayload, ctx, env };
  try {
    await fetch("/api/diag/client-error", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Diagnostics must never throw back into the failing path.
  }
}

/**
 * Extract the trailing ffmpeg log lines we stitched into the error
 * message via the « — » separator (see prepareVideoForUpload). Returns
 * an empty array when the separator is absent.
 */
export function extractFfmpegLogTail(err: unknown): string[] {
  const msg = err instanceof Error ? err.message : "";
  const sep = msg.lastIndexOf(" — ");
  if (sep < 0) return [];
  return msg
    .slice(sep + 3)
    .split(" | ")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface TgWebApp {
  platform?: string;
  version?: string;
}

function captureEnv(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  const tg = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram
    ?.WebApp;
  return {
    ua: navigator.userAgent,
    // tg_platform: "ios" | "android" | "tdesktop" | "macos" | "weba" | "webk"
    tg_platform: tg?.platform ?? null,
    tg_version: tg?.version ?? null,
    viewport_w: window.innerWidth,
    viewport_h: window.innerHeight,
    dpr: window.devicePixelRatio,
  };
}
