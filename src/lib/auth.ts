import crypto from "node:crypto";
import { SignJWT } from "jose";
import { serverEnv } from "./env";

export type InitDataMap = Map<string, string>;

export type VerifyResult =
  | { ok: true; data: InitDataMap }
  | { ok: false; reason: string };

export interface VerifyOptions {
  maxAgeSeconds?: number;
}

export function verifyInitData(
  initData: string,
  botToken: string,
  opts: VerifyOptions = {},
): VerifyResult {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing hash" };
  params.delete("hash");

  const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (!timingSafeEqualHex(computed, hash)) {
    return { ok: false, reason: "bad hash" };
  }

  const authDate = Number(params.get("auth_date") ?? "0");
  const maxAge = opts.maxAgeSeconds ?? 86400;
  if (!authDate || Date.now() / 1000 - authDate > maxAge) {
    return { ok: false, reason: "stale" };
  }

  return { ok: true, data: new Map(entries) };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface ParsedInitData {
  user: TelegramUser;
  authDate: number;
  queryId?: string;
}

export function parseInitData(data: InitDataMap): ParsedInitData {
  const userRaw = data.get("user");
  if (!userRaw) throw new Error("user missing in initData");
  const user = JSON.parse(userRaw) as TelegramUser;
  return {
    user,
    authDate: Number(data.get("auth_date") ?? "0"),
    queryId: data.get("query_id") ?? undefined,
  };
}

export async function mintSupabaseJwt(tgUserId: number, appRole: string): Promise<string> {
  const secret = new TextEncoder().encode(serverEnv.SUPABASE_JWT_SECRET);
  return await new SignJWT({ role: "authenticated", app_role: appRole })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(tgUserId))
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}
