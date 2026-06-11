import { ru } from "@/lib/i18n";

/** One-line human metric for a flag, shared by the admin panel and the
 * cron's digest so the two surfaces can't drift. Meta keys are the
 * contract written by /api/cron/engagement. */
export function engagementMetricLine(
  kind: string,
  meta: Record<string, unknown>,
): string {
  switch (kind) {
    case "inactive":
      return ru.admin.engagement.metricInactive(Number(meta.days_silent ?? 0));
    case "slump": {
      const cur = Number(meta.current_week_s ?? 0);
      const prior = Math.max(1, Number(meta.prior_week_s ?? 1));
      return ru.admin.engagement.metricSlump(Math.round((1 - cur / prior) * 100));
    }
    case "plateau":
      return ru.admin.engagement.metricPlateau(
        Number(meta.streak ?? 0),
        Math.round(Number(meta.median7_s ?? 0)),
      );
    case "ghosting":
      return ru.admin.engagement.metricGhosting(Number(meta.gap_hours ?? 0));
    case "tutor_sla":
      return ru.admin.engagement.metricTutorSla(Number(meta.pending_hours ?? 0));
    default:
      return "";
  }
}
