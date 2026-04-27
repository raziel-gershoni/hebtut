import { jwtVerify } from "jose";
import { serverEnv } from "./env";
import { getServiceRoleClient } from "./supabase-server";
import type { UserRole } from "@/types/database";

export interface AuthedUser {
  id: number;
  tgUserId: number;
  role: UserRole;
  name: string | null;
}

export async function authFromRequest(req: Request): Promise<AuthedUser | null> {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(auth);
  const url = new URL(req.url);
  const token = m?.[1] ?? url.searchParams.get("token");
  if (!token) return null;

  const secret = new TextEncoder().encode(serverEnv.SUPABASE_JWT_SECRET);
  let sub: string | undefined;
  try {
    const v = await jwtVerify(token, secret);
    sub = (v.payload as { sub?: string }).sub;
  } catch {
    return null;
  }
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
