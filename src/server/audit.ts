import { getServiceRoleClient } from "@/lib/supabase-server";
import type { Json } from "@/types/database";

export type AuditSubjectType =
  | "user"
  | "message"
  | "claim"
  | "invite"
  | "link"
  | "banlist"
  | "media_library"
  | "media_tag"
  | "acquisition_source";

export interface AuditEventInput {
  /** Event code in `<area>.<verb>` form. Free text — see CONVENTIONS in audit_events migration. */
  action: string;
  /** Internal users.id of who did this. NULL for system events (cron, fan-out). */
  actorId?: number | null;
  subjectType?: AuditSubjectType | null;
  subjectId?: number | null;
  /** Free-form payload — keep it small (<1KB). */
  meta?: Record<string, unknown>;
}

/**
 * Records one row in `audit_events`. Fail-soft: an audit failure is logged
 * to console but never thrown, so the calling state-changing operation
 * (a claim refresh, a message insert, an admin mutation) is unaffected
 * by infrastructure trouble on the audit table.
 */
export async function recordAudit(input: AuditEventInput): Promise<void> {
  try {
    const sb = getServiceRoleClient();
    const { error } = await sb.from("audit_events").insert({
      actor_id: input.actorId ?? null,
      action: input.action,
      subject_type: input.subjectType ?? null,
      subject_id: input.subjectId ?? null,
      meta: (input.meta ?? {}) as Json,
    });
    if (error) {
      console.warn("audit recordAudit failed", {
        action: input.action,
        error: error.message,
      });
    }
  } catch (e) {
    console.warn("audit recordAudit threw", {
      action: input.action,
      reason: (e as Error).message,
    });
  }
}
