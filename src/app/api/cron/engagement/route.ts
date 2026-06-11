import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getBot } from "@/lib/tg";
import { ru } from "@/lib/i18n";
import { recordAudit } from "@/server/audit";
import { localDateInTz } from "@/lib/time";
import type { Json } from "@/types/database";
import {
  GHOSTING_HOURS,
  GHOSTING_LOOKBACK_DAYS,
  SIGNAL_WINDOW_DAYS,
  TUTOR_SLA_HOURS,
  classifyInactivity,
  computePracticeSignals,
  diffFlagStates,
  evaluatePlateau,
  evaluateSlump,
  type DesiredFlag,
  type ExistingFlag,
  type Transition,
} from "@/server/engagement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

interface MonitoredStudent {
  id: number;
  tz: string;
  name: string | null;
  preferred_name: string | null;
  anchor_fallback_iso: string; // trial_started_at ?? created_at
}

async function handler(req: NextRequest): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return new Response("forbidden", { status: 403 });
  }
  const sb = getServiceRoleClient();
  const now = new Date();
  const nowIso = now.toISOString();

  // 1. Monitored population: students, not suspended, raw sub status
  // trial/active, trial not yet past its end (the hourly subscriptions
  // cron flips those; we just skip not-yet-flipped rows), not frozen.
  const { data: rows } = await sb
    .from("users")
    .select(
      "id, tz, name, preferred_name, created_at, subscriptions!inner(status, trial_started_at, trial_ends_at, frozen_until)",
    )
    .eq("role", "student")
    .eq("status", "active")
    .in("subscriptions.status", ["trial", "active"]);

  const studentsRaw: MonitoredStudent[] = (rows ?? [])
    .filter((r) => {
      const sub = Array.isArray(r.subscriptions) ? r.subscriptions[0] : r.subscriptions;
      if (!sub) return false;
      if (sub.status === "trial" && sub.trial_ends_at && new Date(sub.trial_ends_at) < now) return false;
      if (sub.frozen_until && new Date(sub.frozen_until) > now) return false;
      return true;
    })
    .map((r) => {
      const sub = Array.isArray(r.subscriptions) ? r.subscriptions[0] : r.subscriptions;
      return {
        id: r.id,
        tz: r.tz ?? serverEnv.DEFAULT_TZ,
        name: r.name,
        preferred_name: r.preferred_name,
        anchor_fallback_iso: sub?.trial_started_at ?? r.created_at,
      };
    });

  // Dedup by student id: a student with two matching subscription rows appears
  // twice via the !inner join. Keep first occurrence.
  const dedupMap = new Map<number, MonitoredStudent>();
  for (const s of studentsRaw) {
    if (!dedupMap.has(s.id)) dedupMap.set(s.id, s);
  }
  const students: MonitoredStudent[] = [...dedupMap.values()];

  const monitoredIds = new Set(students.map((s) => s.id));

  // 2. Open flags (for everyone, incl. students who left the population).
  const { data: openFlags } = await sb
    .from("student_flags")
    .select("student_id, kind, tier")
    .is("resolved_at", null);
  const openByStudent = new Map<number, ExistingFlag[]>();
  for (const f of openFlags ?? []) {
    const arr = openByStudent.get(f.student_id) ?? [];
    arr.push({ kind: f.kind, tier: f.tier });
    openByStudent.set(f.student_id, arr);
  }

  // 3. Batched signal reads.
  const ids = students.map((s) => s.id);
  const windowStartIso = new Date(now.getTime() - (SIGNAL_WINDOW_DAYS + 2) * 86400_000)
    .toISOString()
    .slice(0, 10);
  const { data: usage } = ids.length
    ? await sb
        .from("quota_usage")
        .select("student_id, date, seconds_used")
        .in("student_id", ids)
        .gte("date", windowStartIso)
    : { data: [] as { student_id: number; date: string; seconds_used: number }[] };
  const usageByStudent = new Map<number, Map<string, number>>();
  for (const u of usage ?? []) {
    const m = usageByStudent.get(u.student_id) ?? new Map<string, number>();
    m.set(u.date, u.seconds_used);
    usageByStudent.set(u.student_id, m);
  }

  // Latest in/out per student over the ghosting lookback.
  const msgsSinceIso = new Date(now.getTime() - GHOSTING_LOOKBACK_DAYS * 86400_000).toISOString();
  const { data: recentMsgs } = ids.length
    ? await sb
        .from("messages")
        .select("student_id, direction, created_at")
        .in("student_id", ids)
        .gte("created_at", msgsSinceIso)
    : { data: [] as { student_id: number; direction: string; created_at: string }[] };
  const latestIn = new Map<number, number>();
  const latestOut = new Map<number, number>();
  for (const m of recentMsgs ?? []) {
    const t = new Date(m.created_at).getTime();
    const map = m.direction === "in" ? latestIn : latestOut;
    if ((map.get(m.student_id) ?? 0) < t) map.set(m.student_id, t);
  }

  // Oldest pending inbound per student (tutor SLA).
  const slaCutoffIso = new Date(now.getTime() - TUTOR_SLA_HOURS * 3600_000).toISOString();
  const { data: pendingRows } = ids.length
    ? await sb
        .from("messages")
        .select("student_id, id, created_at")
        .in("student_id", ids)
        .eq("direction", "in")
        .eq("status", "pending")
        .lt("created_at", slaCutoffIso)
    : { data: [] as { student_id: number; id: number; created_at: string }[] };
  const oldestPending = new Map<number, { id: number; created_at: string }>();
  for (const p of pendingRows ?? []) {
    const cur = oldestPending.get(p.student_id);
    if (!cur || p.created_at < cur.created_at) {
      oldestPending.set(p.student_id, { id: p.id, created_at: p.created_at });
    }
  }

  // Pre-run snapshot: students who had ANY open flag before this run.
  const preRunFlaggedIds = new Set(openByStudent.keys());

  // 4. Evaluate + diff per student.
  let opened = 0;
  let escalated = 0;
  let resolved = 0;
  const newFlagLines: string[] = [];

  async function applyTransition(studentId: number, t: Transition): Promise<void> {
    if (t.type === "resolve") {
      await sb
        .from("student_flags")
        .update({ resolved_at: nowIso, last_evaluated_at: nowIso })
        .eq("student_id", studentId)
        .eq("kind", t.kind)
        .is("resolved_at", null);
      resolved++;
      await recordAudit({
        action: "engagement.flag_resolve",
        actorId: null,
        subjectType: "user",
        subjectId: studentId,
        meta: { kind: t.kind, ...(t.reason ? { reason: t.reason } : {}) },
      });
      return;
    }
    // For escalate, we preserve opened_at (don't include it in the upsert).
    // For open, we set opened_at to nowIso.
    if (t.type === "open") {
      await sb.from("student_flags").upsert(
        {
          student_id: studentId,
          kind: t.kind,
          tier: t.tier,
          opened_at: nowIso,
          last_evaluated_at: nowIso,
          resolved_at: null,
          meta: t.meta as Json,
        },
        { onConflict: "student_id,kind" },
      );
    } else {
      await sb.from("student_flags").upsert(
        {
          student_id: studentId,
          kind: t.kind,
          tier: t.tier,
          last_evaluated_at: nowIso,
          resolved_at: null,
          meta: t.meta as Json,
        },
        { onConflict: "student_id,kind" },
      );
    }
    if (t.type === "open") opened++;
    else escalated++;
    await recordAudit({
      action: t.type === "open" ? "engagement.flag_open" : "engagement.flag_escalate",
      actorId: null,
      subjectType: "user",
      subjectId: studentId,
      meta: { kind: t.kind, tier: t.tier, ...t.meta },
    });
  }

  for (const s of students) {
    try {
      const todayLocal = localDateInTz(now, s.tz);
      const fallbackAnchorLocal = localDateInTz(new Date(s.anchor_fallback_iso), s.tz);
      const signals = computePracticeSignals(
        usageByStudent.get(s.id) ?? new Map(),
        todayLocal,
        fallbackAnchorLocal,
      );
      const existing = openByStudent.get(s.id) ?? [];
      const has = (k: string) => existing.some((e) => e.kind === k);

      const desired: DesiredFlag[] = [];

      const tier =
        signals.daysSinceAnchor != null ? classifyInactivity(signals.daysSinceAnchor) : null;
      if (tier) {
        desired.push({
          kind: "inactive",
          tier,
          meta: { days_silent: signals.daysSinceAnchor },
        });
      }

      // Adaptation: evaluateSlump now takes a 4th param inactiveIsOpen that
      // short-circuits to false when true (inactive flag owns the situation).
      // No external !tier gate needed — the function handles suppression.
      if (evaluateSlump(signals.currentWeekS, signals.priorWeekS, has("slump"), has("inactive"))) {
        desired.push({
          kind: "slump",
          tier: null,
          meta: { current_week_s: signals.currentWeekS, prior_week_s: signals.priorWeekS },
        });
      }

      if (evaluatePlateau(signals.streak, signals.median7, signals.median30, has("plateau"))) {
        desired.push({
          kind: "plateau",
          tier: null,
          meta: { streak: signals.streak, median7_s: signals.median7, median30_s: signals.median30 },
        });
      }

      const inT = latestIn.get(s.id) ?? 0;
      const outT = latestOut.get(s.id) ?? 0;
      if (inT > 0 && outT > inT && now.getTime() - outT >= GHOSTING_HOURS * 3600_000) {
        desired.push({
          kind: "ghosting",
          tier: null,
          meta: { gap_hours: Math.round((now.getTime() - outT) / 3600_000) },
        });
      }

      const pending = oldestPending.get(s.id);
      if (pending) {
        desired.push({
          kind: "tutor_sla",
          tier: null,
          meta: {
            pending_message_id: pending.id,
            pending_hours: Math.round(
              (now.getTime() - new Date(pending.created_at).getTime()) / 3600_000,
            ),
          },
        });
      }

      const transitions = diffFlagStates(existing, desired);
      for (const t of transitions) {
        await applyTransition(s.id, t);
        if (t.type === "open" || t.type === "escalate") {
          const name = s.preferred_name ?? s.name ?? `#${s.id}`;
          newFlagLines.push(`${ru.bot.engagementDigest.newPrefix}${name} — ${metricLine(t)}`);
        }
      }
      // Touch last_evaluated_at + refresh meta on unchanged open flags.
      for (const d of desired) {
        if (transitions.every((t) => t.kind !== d.kind)) {
          await sb
            .from("student_flags")
            .update({ last_evaluated_at: nowIso, meta: d.meta as Json })
            .eq("student_id", s.id)
            .eq("kind", d.kind)
            .is("resolved_at", null);
        }
      }
    } catch (e) {
      console.warn("[engagement] student sweep failed", {
        student_id: s.id,
        reason: (e as Error).message,
      });
    }
  }

  // 5. Resolve flags of students who left the population.
  for (const [studentId, flags] of openByStudent) {
    if (monitoredIds.has(studentId)) continue;
    for (const f of flags) {
      await applyTransition(studentId, { type: "resolve", kind: f.kind, reason: "excluded" });
    }
  }

  // 6. Digest DM to admins (only when something is open).
  const { data: stillOpen } = await sb
    .from("student_flags")
    .select("student_id, kind, tier, meta, users!inner(name, preferred_name)")
    .is("resolved_at", null);
  let digested = 0;
  if (stillOpen?.length) {
    const text = buildDigestText(newFlagLines, stillOpen, preRunFlaggedIds);
    const { data: admins } = await sb
      .from("users")
      .select("id, tg_chat_id")
      .eq("is_admin", true)
      .not("tg_chat_id", "is", null);
    const base = serverEnv.APP_BASE_URL.replace(/\/$/, "");
    for (const a of admins ?? []) {
      try {
        await getBot().api.sendMessage(a.tg_chat_id, text, {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: ru.bot.engagementDigest.openPanelButton,
                  web_app: { url: `${base}/admin` },
                },
              ],
            ],
          },
        });
        digested++;
      } catch (e) {
        console.warn("[engagement] digest DM failed", {
          admin_id: a.id,
          reason: (e as Error).message,
        });
      }
    }
    await recordAudit({
      action: "engagement.digest_sent",
      actorId: null,
      meta: { open_flags: stillOpen.length, new_lines: newFlagLines.length, admins_sent: digested },
    });
  }

  return Response.json({ students: students.length, opened, escalated, resolved, digested });
}

function metricLine(t: { kind: string; tier?: string | null; meta: Record<string, unknown> }): string {
  switch (t.kind) {
    case "inactive":
      return ru.admin.engagement.metricInactive(Number(t.meta.days_silent ?? 0));
    case "slump": {
      const cur = Number(t.meta.current_week_s ?? 0);
      const prior = Number(t.meta.prior_week_s ?? 1);
      return ru.admin.engagement.metricSlump(Math.round((1 - cur / Math.max(1, prior)) * 100));
    }
    case "plateau":
      return ru.admin.engagement.metricPlateau(
        Number(t.meta.streak ?? 0),
        Math.round(Number(t.meta.median7_s ?? 0)),
      );
    case "ghosting":
      return ru.admin.engagement.metricGhosting(Number(t.meta.gap_hours ?? 0));
    case "tutor_sla":
      return ru.admin.engagement.metricTutorSla(Number(t.meta.pending_hours ?? 0));
    default:
      return "";
  }
}

function buildDigestText(
  newLines: string[],
  open: { student_id: number; kind: string; tier: string | null; meta: unknown; users: unknown }[],
  preRunFlaggedIds: Set<number>,
): string {
  const header =
    newLines.length > 0
      ? ru.bot.engagementDigest.header(newLines.length, open.length)
      : ru.bot.engagementDigest.headerNoNew(open.length);

  // Ongoing = students who had a flag before this run AND still have one open.
  // Dedup by student id (not by name string) to avoid double-counting escalates.
  const postRunStudentIds = new Set(open.map((f) => f.student_id));
  const seenOngoing = new Set<number>();
  const ongoingNames: string[] = [];
  for (const f of open) {
    if (!preRunFlaggedIds.has(f.student_id)) continue;
    if (!postRunStudentIds.has(f.student_id)) continue;
    if (seenOngoing.has(f.student_id)) continue;
    seenOngoing.add(f.student_id);
    if (ongoingNames.length >= 15) continue;
    const u = (Array.isArray(f.users) ? f.users[0] : f.users) as {
      name: string | null;
      preferred_name: string | null;
    } | null;
    ongoingNames.push(u?.preferred_name ?? u?.name ?? "?");
  }

  const ongoingLine =
    ongoingNames.length > 0
      ? `${ru.bot.engagementDigest.ongoingPrefix}${ongoingNames.join(", ")}`
      : "";
  return [header, "", ...newLines, "", ongoingLine].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

export { handler as GET, handler as POST };
