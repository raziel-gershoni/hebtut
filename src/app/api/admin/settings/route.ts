import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";
import { recordAudit } from "@/server/audit";
import { invalidateSettingsCache } from "@/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Whitelist of admin-toggleable keys + their value validators. Keep this
// list tight — anything not listed is rejected at PATCH time so a typo'd
// key can't pollute app_settings.
const KEYS = {
  quota_chat_notifications_enabled: z.boolean(),
  billing_stars_enabled: z.boolean(),
  display_anonymous_handles_enabled: z.boolean(),
  media_uploads_teachers_enabled: z.boolean(),
  transcripts_enabled: z.boolean(),
} as const;
type SettingKey = keyof typeof KEYS;

function isKnownKey(k: string): k is SettingKey {
  return Object.prototype.hasOwnProperty.call(KEYS, k);
}

interface SettingsResponse {
  quota_chat_notifications_enabled: boolean;
  billing_stars_enabled: boolean;
  display_anonymous_handles_enabled: boolean;
  media_uploads_teachers_enabled: boolean;
  transcripts_enabled: boolean;
}

export async function GET(req: NextRequest): Promise<Response> {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();
  const { data } = await sb
    .from("app_settings")
    .select("key, value")
    .in("key", Object.keys(KEYS));
  const out: SettingsResponse = {
    quota_chat_notifications_enabled: false,
    billing_stars_enabled: false,
    display_anonymous_handles_enabled: false,
    media_uploads_teachers_enabled: false,
    transcripts_enabled: false,
  };
  for (const row of data ?? []) {
    if (row.key === "quota_chat_notifications_enabled") {
      out.quota_chat_notifications_enabled = row.value === true;
    } else if (row.key === "billing_stars_enabled") {
      out.billing_stars_enabled = row.value === true;
    } else if (row.key === "display_anonymous_handles_enabled") {
      out.display_anonymous_handles_enabled = row.value === true;
    } else if (row.key === "media_uploads_teachers_enabled") {
      out.media_uploads_teachers_enabled = row.value === true;
    } else if (row.key === "transcripts_enabled") {
      out.transcripts_enabled = row.value === true;
    }
  }
  return Response.json({ settings: out }, { headers: noStoreHeaders });
}

const Body = z.object({
  key: z.string(),
  value: z.unknown(),
});

export async function PATCH(req: NextRequest): Promise<Response> {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return new Response("bad body", { status: 400, headers: noStoreHeaders });
  }
  const { key, value } = parsed.data;
  if (!isKnownKey(key)) {
    return new Response("unknown key", { status: 400, headers: noStoreHeaders });
  }
  const valueOk = KEYS[key].safeParse(value);
  if (!valueOk.success) {
    return new Response("bad value", { status: 400, headers: noStoreHeaders });
  }

  const sb = getServiceRoleClient();
  const { data: prior } = await sb
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  const { error } = await sb
    .from("app_settings")
    .upsert(
      { key, value: valueOk.data, updated_by: user.id, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) {
    return new Response(error.message, { status: 500, headers: noStoreHeaders });
  }

  invalidateSettingsCache();

  await recordAudit({
    action: "settings.update",
    actorId: user.id,
    meta: {
      key,
      from: prior?.value ?? null,
      to: valueOk.data,
    },
  });

  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
