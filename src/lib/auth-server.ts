import { jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";
import { publicEnv } from "./env";
import { getServiceRoleClient } from "./supabase-server";
import type { UserRole } from "@/types/database";

export interface AuthedUser {
  id: number;
  tgUserId: number;
  role: UserRole;
  isAdmin: boolean;
  name: string | null;
}

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (cachedJwks) return cachedJwks;
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
    const v = await jwtVerify(token, getJwks(), {
      audience: "authenticated",
      issuer: `${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`,
    });
    payload = v.payload;
  } catch (e) {
    console.warn("JWT verify failed", { reason: (e as Error).message });
    return null;
  }
  const sub = payload.sub;
  if (!sub) return null;
  const tgUserId = Number(sub);
  if (!Number.isFinite(tgUserId)) return null;

  const sb = getServiceRoleClient();
  const { data } = await sb
    .from("users")
    .select("id, tg_user_id, role, is_admin, name")
    .eq("tg_user_id", tgUserId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    tgUserId: Number(data.tg_user_id),
    role: data.role,
    isAdmin: data.is_admin,
    name: data.name,
  };
}

// Permission helpers — three predicates, one per access pattern.

/** Admin-only management endpoints. */
export function isAdminOnly(user: AuthedUser | null): user is AuthedUser {
  return !!user && user.isAdmin;
}

/** Strict role check — used by /api/claim where admin alone is not enough. */
export function hasRole(
  user: AuthedUser | null,
  roles: readonly UserRole[],
): user is AuthedUser {
  return !!user && roles.includes(user.role);
}

/**
 * Read endpoints that the admin should be able to oversee even without being a
 * teacher (inbox, threads, media). Admins still cannot CLAIM or REPLY without
 * role='teacher' — see /api/claim and teacher-reply.ts.
 */
export function canTeachOrReadAsAdmin(user: AuthedUser | null): user is AuthedUser {
  return !!user && (user.role === "teacher" || user.isAdmin);
}

/** @deprecated Kept for backwards compatibility with any straggling callers. */
export function requireRole(
  user: AuthedUser | null,
  roles: readonly UserRole[],
): user is AuthedUser {
  return hasRole(user, roles);
}
