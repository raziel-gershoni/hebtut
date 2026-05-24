import { ru } from "@/lib/i18n";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";
import { recordAudit } from "@/server/audit";
import { fanOutFeedbackToAdmins } from "@/server/feedback";
import { userHandle } from "@/lib/handle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const Body = z.object({
  text: z.string().min(1).max(4000),
});

interface RawMessage {
  id: number;
  direction: "in" | "out";
  text_content: string;
  author_id: number | null;
  created_at: string;
}

export async function GET(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!user) return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  // Admins use the admin panel, not this endpoint.
  if (user.isAdmin)
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });

  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb
    .from("feedback_messages")
    .select("id, direction, text_content, author_id, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) return new Response(error.message, { status: 500, headers: noStoreHeaders });

  // Resolve out-direction author handles for privacy-safe display.
  const authorIds = Array.from(
    new Set(
      ((rows ?? []) as RawMessage[])
        .filter((m) => m.direction === "out" && m.author_id != null)
        .map((m) => m.author_id as number),
    ),
  );
  const handlesById = new Map<number, string>();
  if (authorIds.length > 0) {
    const { data: authors } = await sb
      .from("users")
      .select("id, tg_user_id, display_handle")
      .in("id", authorIds);
    for (const a of authors ?? []) {
      const h = a.display_handle ?? userHandle(a.tg_user_id).handle;
      handlesById.set(a.id, h);
    }
  }

  const messages = ((rows ?? []) as RawMessage[]).map((m) => ({
    id: m.id,
    direction: m.direction,
    text_content: m.text_content,
    created_at: m.created_at,
    author:
      m.direction === "out" && m.author_id != null
        ? { handle: handlesById.get(m.author_id) ?? ru.bot.labels.adminFallback }
        : null,
  }));

  return Response.json({ messages }, { headers: noStoreHeaders });
}

export async function POST(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!user) return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  if (user.isAdmin)
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });

  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success)
    return new Response("bad body", { status: 400, headers: noStoreHeaders });

  const sb = getServiceRoleClient();
  const { data: row, error } = await sb
    .from("feedback_messages")
    .insert({
      user_id: user.id,
      direction: "in",
      author_id: user.id,
      text_content: parsed.data.text,
    })
    .select("id")
    .single();
  if (error || !row)
    return new Response(error?.message ?? "insert failed", {
      status: 500,
      headers: noStoreHeaders,
    });

  await recordAudit({
    action: "feedback.in",
    actorId: user.id,
    subjectType: "user",
    subjectId: user.id,
    meta: { snippet: parsed.data.text.slice(0, 80) },
  });

  await fanOutFeedbackToAdmins({ userId: user.id, text: parsed.data.text });

  return Response.json({ ok: true, id: row.id }, { headers: noStoreHeaders });
}
