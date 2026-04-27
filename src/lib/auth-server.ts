import { jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";
import { publicEnv } from "./env";
import { getServiceRoleClient } from "./supabase-server";
import type { UserRole } from "@/types/database";

export interface AuthedUser {
  id: number;
  tgUserId: number;
  role: UserRole;
  name: string | null;
}

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (cachedJwks) return cachedJwks;
  // Supabase publishes the active and accepted-for-rotation public keys here.
  // Project Settings → JWT Keys controls which keys are published.
  const jwksUrl = new URL(`${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
  cachedJwks = createRemoteJWKSet(jwksUrl);
  return cachedJwks;
}

export async function authFromRequest(req: Request): Promise<AuthedUser | null> {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(auth);
  const url = new URL(req.url);
  const token = m?.[1] ?? url.searchParams.get("token");
  if (!token) return null;

  let payload: JWTPayload;
  try {
    const v = await jwtVerify(token, getJwks());
    payload = v.payload;
  } catch {
    return null;
  }
  const sub = payload.sub;
  if (!sub) return null;
  const tgUserId = Number(sub);
  if (!Number.isFinite(tgUserId)) return null;

  const sb = getServiceRoleClient();
  const { data } = await sb
    .from("users")
    .select("id, tg_user_id, role, name")
    .eq("tg_user_id", tgUserId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    tgUserId: Number(data.tg_user_id),
    role: data.role,
    name: data.name,
  };
}

export function requireRole(
  user: AuthedUser | null,
  roles: readonly UserRole[],
): user is AuthedUser {
  return !!user && roles.includes(user.role);
}
