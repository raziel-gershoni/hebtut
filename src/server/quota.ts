import { getServiceRoleClient } from "@/lib/supabase-server";
import { localDateInTz } from "@/lib/time";
import { serverEnv } from "@/lib/env";

export function computeRemaining(usedSeconds: number, budgetSeconds: number): number {
  return Math.max(0, budgetSeconds - usedSeconds);
}

export async function getRemainingForToday(studentId: number, tz: string): Promise<number> {
  const sb = getServiceRoleClient();
  const today = localDateInTz(new Date(), tz);
  const { data } = await sb
    .from("quota_usage")
    .select("seconds_used")
    .eq("student_id", studentId)
    .eq("date", today)
    .maybeSingle();
  const used = data?.seconds_used ?? 0;
  return computeRemaining(used, serverEnv.DAILY_QUOTA_SECONDS);
}

export async function commitUsage(
  studentId: number,
  tz: string,
  seconds: number,
): Promise<number> {
  const sb = getServiceRoleClient();
  const today = localDateInTz(new Date(), tz);
  const { data: existing } = await sb
    .from("quota_usage")
    .select("seconds_used")
    .eq("student_id", studentId)
    .eq("date", today)
    .maybeSingle();
  const newUsed = (existing?.seconds_used ?? 0) + seconds;
  await sb
    .from("quota_usage")
    .upsert(
      { student_id: studentId, date: today, seconds_used: newUsed },
      { onConflict: "student_id,date" },
    );
  return computeRemaining(newUsed, serverEnv.DAILY_QUOTA_SECONDS);
}
