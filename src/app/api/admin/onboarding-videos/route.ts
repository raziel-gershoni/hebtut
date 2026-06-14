import type { NextRequest } from "next/server";
import { authFromRequest, isAdminOnly } from "@/lib/auth-server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { noStoreHeaders } from "@/lib/no-cache";
import { signedLibraryMediaUrl } from "@/server/media-storage";
import type { OnboardingVideoStep } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const STEPS: readonly OnboardingVideoStep[] = ["video1", "video2", "video3"] as const;

type Clip = {
  id: number;
  position: number;
  storage_path: string;
  /** Server-minted presigned R2 GET URL (6h). The admin UI plays from this
   * directly — no Supabase public URL, no proxy. Undefined if this one clip's
   * presign threw (one bad presign leaves its own url undefined rather than
   * 500-ing the whole list). */
  url: string | undefined;
  original_filename: string;
  mime_type: string;
  bytes: number;
  duration_seconds: number | null;
  uploaded_at: string;
  uploaded_by_user_id: number;
};

type Slot = {
  step: OnboardingVideoStep;
  clips: Clip[];
};

export async function GET(req: NextRequest): Promise<Response> {
  const me = await authFromRequest(req);
  if (!isAdminOnly(me)) {
    return new Response("forbidden", { status: 403, headers: noStoreHeaders });
  }
  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb
    .from("onboarding_videos")
    .select(
      "id, step, position, storage_path, original_filename, mime_type, bytes, duration_seconds, uploaded_at, uploaded_by_user_id",
    )
    .order("step", { ascending: true })
    .order("position", { ascending: true });
  if (error) {
    return new Response(error.message, { status: 500, headers: noStoreHeaders });
  }
  // Presign each clip's R2 object server-side so the admin UI plays straight
  // from R2 (no Supabase public URL). Signing is local crypto (no network
  // round-trip), so per-clip in parallel is cheap. R2-only — but with a
  // per-item try/catch (mirrors the thread API's library presign): one bad
  // presign leaves that clip's `url` undefined rather than 500-ing the whole
  // list, so a single dead object doesn't blank the entire admin panel.
  const byStep = new Map<OnboardingVideoStep, Clip[]>();
  for (const step of STEPS) byStep.set(step, []);
  await Promise.all(
    (rows ?? []).map(async (r) => {
      const list = byStep.get(r.step as OnboardingVideoStep);
      if (!list) return;
      let url: string | undefined;
      try {
        url = await signedLibraryMediaUrl(r.storage_path);
      } catch {
        url = undefined;
      }
      list.push({
        id: r.id,
        position: r.position,
        storage_path: r.storage_path,
        url,
        original_filename: r.original_filename,
        mime_type: r.mime_type,
        bytes: r.bytes,
        duration_seconds: r.duration_seconds,
        uploaded_at: r.uploaded_at,
        uploaded_by_user_id: r.uploaded_by_user_id,
      });
    }),
  );
  // Promise.all may settle out of order; re-sort each step by position so the
  // UI keeps the intended clip ordering (the SQL ORDER BY no longer survives).
  for (const list of byStep.values()) {
    list.sort((a, b) => a.position - b.position);
  }
  const slots: Slot[] = STEPS.map((step) => ({
    step,
    clips: byStep.get(step) ?? [],
  }));
  return Response.json({ slots }, { headers: noStoreHeaders });
}
