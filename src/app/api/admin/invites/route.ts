import type { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { serverEnv } from "@/lib/env";
import { buildInviteUrl } from "@/server/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface InviteRow {
  id: number;
  token: string;
  created_at: string;
  consumed_at: string | null;
  consumed_by: number | null;
  revoked_at: string | null;
}

export async function GET(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) return new Response("forbidden", { status: 403 });

  const sb = getServiceRoleClient();
  const { data: invites, error } = await sb
    .from("teacher_invites")
    .select("id, token, created_at, consumed_at, consumed_by, revoked_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return new Response(error.message, { status: 500 });

  // Resolve consumed_by → name in one shot.
  const consumerIds = Array.from(
    new Set(
      (invites ?? [])
        .map((i: InviteRow) => i.consumed_by)
        .filter((id: number | null): id is number => id != null),
    ),
  );
  const namesById = new Map<number, string>();
  if (consumerIds.length > 0) {
    const { data: rows } = await sb
      .from("users")
      .select("id, name")
      .in("id", consumerIds);
    for (const r of rows ?? []) namesById.set(r.id, r.name ?? `user ${r.id}`);
  }

  const enriched = (invites ?? []).map((i: InviteRow) => {
    const state = i.revoked_at
      ? "revoked"
      : i.consumed_at
        ? "consumed"
        : "active";
    return {
      id: i.id,
      token: i.token,
      url: buildInviteUrl(serverEnv.TELEGRAM_BOT_USERNAME, i.token),
      created_at: i.created_at,
      consumed_at: i.consumed_at,
      consumed_by_name: i.consumed_by != null ? namesById.get(i.consumed_by) ?? null : null,
      revoked_at: i.revoked_at,
      state,
    };
  });

  return Response.json({ invites: enriched }, { headers: noStoreHeaders });
}

export async function POST(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) return new Response("forbidden", { status: 403 });

  const token = randomBytes(24).toString("base64url");
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("teacher_invites")
    .insert({ token, created_by: user.id })
    .select("id, token, created_at")
    .single();
  if (error || !data) return new Response(error?.message ?? "insert failed", { status: 500 });

  return Response.json(
    {
      id: data.id,
      token: data.token,
      url: buildInviteUrl(serverEnv.TELEGRAM_BOT_USERNAME, data.token),
      created_at: data.created_at,
      state: "active",
    },
    { headers: noStoreHeaders },
  );
}
