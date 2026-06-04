import type { NextRequest } from "next/server";
import { z } from "zod";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { readJsonBody } from "@/lib/http";
import { noStoreHeaders } from "@/lib/no-cache";
import { serverEnv } from "@/lib/env";
import { buildAcquisitionUrl } from "@/server/invites";
import { recordAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const Body = z.object({
  label: z.string().trim().min(1).max(80),
});

interface SourceRow {
  id: number;
  slug: string;
  label: string;
  created_at: string;
  revoked_at: string | null;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function GET(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) return new Response("forbidden", { status: 403 });

  const sb = getServiceRoleClient();
  const { data: sources, error } = await sb
    .from("acquisition_sources")
    .select("id, slug, label, created_at, revoked_at")
    .order("created_at", { ascending: false });
  if (error) return new Response(error.message, { status: 500 });

  // Signup counts per source. Single grouped query.
  const ids = (sources ?? []).map((s: SourceRow) => s.id);
  const countsByid = new Map<number, number>();
  if (ids.length > 0) {
    const { data: rows } = await sb
      .from("subscriptions")
      .select("acquisition_source_id")
      .in("acquisition_source_id", ids);
    for (const r of rows ?? []) {
      if (r.acquisition_source_id == null) continue;
      countsByid.set(r.acquisition_source_id, (countsByid.get(r.acquisition_source_id) ?? 0) + 1);
    }
  }

  const enriched = (sources ?? []).map((s: SourceRow) => ({
    id: s.id,
    slug: s.slug,
    label: s.label,
    url: buildAcquisitionUrl(serverEnv.TELEGRAM_BOT_USERNAME, s.slug),
    created_at: s.created_at,
    revoked_at: s.revoked_at,
    state: s.revoked_at ? ("revoked" as const) : ("active" as const),
    signup_count: countsByid.get(s.id) ?? 0,
  }));

  return Response.json({ sources: enriched }, { headers: noStoreHeaders });
}

export async function POST(req: NextRequest) {
  const user = await authFromRequest(req);
  if (!isAdminOnly(user)) return new Response("forbidden", { status: 403 });

  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) return new Response("bad body", { status: 400 });

  const base = slugify(parsed.data.label);
  if (!base) return new Response("label produces empty slug", { status: 400 });

  // Collision loop: append -2, -3, ... until unique. Bounded so a buggy
  // input doesn't spin forever.
  const sb = getServiceRoleClient();
  let slug = base;
  for (let n = 2; n <= 20; n++) {
    const { data: clash } = await sb
      .from("acquisition_sources")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!clash) break;
    slug = `${base}-${n}`.slice(0, 40);
    if (n === 20) return new Response("slug collision", { status: 409 });
  }

  const { data, error } = await sb
    .from("acquisition_sources")
    .insert({ slug, label: parsed.data.label, created_by_user_id: user.id })
    .select("id, slug, label, created_at")
    .single();
  if (error || !data) return new Response(error?.message ?? "insert failed", { status: 500 });

  await recordAudit({
    action: "admin.acquisition_source_create",
    actorId: user.id,
    subjectType: "acquisition_source",
    subjectId: data.id,
    meta: { slug: data.slug, label: data.label },
  });

  return Response.json(
    {
      id: data.id,
      slug: data.slug,
      label: data.label,
      url: buildAcquisitionUrl(serverEnv.TELEGRAM_BOT_USERNAME, data.slug),
      created_at: data.created_at,
      revoked_at: null,
      state: "active" as const,
      signup_count: 0,
    },
    { headers: noStoreHeaders },
  );
}
