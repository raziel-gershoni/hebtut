import { describe, it, expect } from "vitest";
import {
  deriveStatus,
  canSendMedia,
  shouldReplyToLockedUser,
  pickPaymentAnchor,
  type SubscriptionRow,
} from "@/server/subscriptions";

const NOW = new Date("2026-05-09T12:00:00Z");

function row(overrides: Partial<SubscriptionRow>): SubscriptionRow {
  return {
    user_id: 1,
    status: "trial",
    trial_started_at: "2026-05-08T12:00:00Z",
    trial_ends_at: "2026-05-11T12:00:00Z",
    current_period_starts_at: null,
    current_period_ends_at: null,
    next_renewal_at: null,
    freeze_days_used_in_period: 0,
    freeze_period_started_at: null,
    frozen_until: null,
    response_window_start: null,
    response_window_end: null,
    response_window_tz: "Asia/Jerusalem",
    provider: null,
    provider_subscription_id: null,
    provider_customer_id: null,
    referred_by_user_id: null,
    last_motivation_key: null,
    last_motivation_shown_on: null,
    last_lockout_replied_at: null,
    last_renewal_reminder_sent_at: null,
    onboarding_state: "done_skipped",
    onboarding_state_entered_at: "2026-05-08T12:00:00Z",
    onboarding_first_msg_at: null,
    onboarding_first_reply_at: null,
    onboarding_last_active_at: null,
    onboarding_day1_limit_msg_sent_at: null,
    onboarding_last_pause_nudge_at: null,
    unassigned_ack_sent_at: null,
    transcripts_enabled: true,
    translation_enabled: true,
    created_at: "2026-05-08T12:00:00Z",
    updated_at: "2026-05-08T12:00:00Z",
    ...overrides,
  };
}

describe("deriveStatus — trial branch", () => {
  it("returns 'trial' with daysLeft when more than 1 day remains", () => {
    const r = row({ status: "trial", trial_ends_at: "2026-05-11T12:00:00Z" });
    const d = deriveStatus(r, NOW);
    expect(d).toEqual({
      kind: "trial",
      daysLeft: 2,
      endsAt: new Date("2026-05-11T12:00:00Z"),
    });
  });

  it("returns 'trial_ending' with daysLeft=1 when ~24h remain", () => {
    const r = row({ status: "trial", trial_ends_at: "2026-05-10T12:00:00Z" });
    const d = deriveStatus(r, NOW);
    expect(d.kind).toBe("trial_ending");
    if (d.kind === "trial_ending") expect(d.daysLeft).toBe(1);
  });

  it("returns 'trial_ending' with daysLeft=0 when within last 18 hours", () => {
    const r = row({ status: "trial", trial_ends_at: "2026-05-09T20:00:00Z" }); // 8h away
    const d = deriveStatus(r, NOW);
    expect(d.kind).toBe("trial_ending");
    if (d.kind === "trial_ending") expect(d.daysLeft).toBe(0);
  });

  it("returns 'trial_expired' when trial_ends_at is in the past", () => {
    const r = row({ status: "trial", trial_ends_at: "2026-05-09T11:00:00Z" });
    expect(deriveStatus(r, NOW)).toEqual({ kind: "trial_expired" });
  });
});

describe("deriveStatus — active branch", () => {
  it("returns 'active' when more than 2 days remain in the period", () => {
    const r = row({
      status: "active",
      current_period_ends_at: "2026-06-01T12:00:00Z",
    });
    const d = deriveStatus(r, NOW);
    expect(d.kind).toBe("active");
    if (d.kind === "active") expect(d.renewsInDays).toBe(23);
  });

  it("returns 'renewing_soon' when 1-2 days remain", () => {
    const r = row({
      status: "active",
      current_period_ends_at: "2026-05-11T00:00:00Z", // ~36h
    });
    const d = deriveStatus(r, NOW);
    expect(d.kind).toBe("renewing_soon");
    if (d.kind === "renewing_soon") expect(d.renewsInDays).toBe(2);
  });

  it("returns 'lapsed' when current_period_ends_at is in the past", () => {
    const r = row({
      status: "active",
      current_period_ends_at: "2026-05-09T11:00:00Z",
    });
    expect(deriveStatus(r, NOW)).toEqual({ kind: "lapsed" });
  });

  it("returns 'lapsed' when current_period_ends_at is null", () => {
    const r = row({ status: "active", current_period_ends_at: null });
    expect(deriveStatus(r, NOW)).toEqual({ kind: "lapsed" });
  });
});

describe("deriveStatus — frozen branch", () => {
  it("returns 'frozen' while frozen_until is in the future", () => {
    const r = row({
      status: "frozen",
      frozen_until: "2026-05-12T00:00:00Z",
      current_period_ends_at: "2026-06-01T12:00:00Z",
    });
    const d = deriveStatus(r, NOW);
    expect(d.kind).toBe("frozen");
    if (d.kind === "frozen") expect(d.untilDate.toISOString()).toBe("2026-05-12T00:00:00.000Z");
  });

  it("falls through to 'active' when freeze elapsed and period still in future", () => {
    const r = row({
      status: "frozen",
      frozen_until: "2026-05-09T11:00:00Z",
      current_period_ends_at: "2026-06-01T12:00:00Z",
    });
    const d = deriveStatus(r, NOW);
    expect(d.kind).toBe("active");
  });
});

describe("deriveStatus — terminal states pass through", () => {
  it("trial_expired", () => {
    expect(deriveStatus(row({ status: "trial_expired" }), NOW)).toEqual({
      kind: "trial_expired",
    });
  });
  it("lapsed", () => {
    expect(deriveStatus(row({ status: "lapsed" }), NOW)).toEqual({ kind: "lapsed" });
  });
  it("payment_failed", () => {
    expect(deriveStatus(row({ status: "payment_failed" }), NOW)).toEqual({
      kind: "payment_failed",
    });
  });
});

describe("shouldReplyToLockedUser", () => {
  it("replies when never replied before", () => {
    expect(shouldReplyToLockedUser(null, NOW)).toBe(true);
  });
  it("stays silent when last reply was less than 24h ago", () => {
    const recent = new Date(NOW.getTime() - 12 * 3_600_000).toISOString();
    expect(shouldReplyToLockedUser(recent, NOW)).toBe(false);
  });
  it("replies again exactly 24h after the previous reply", () => {
    const exactly24h = new Date(NOW.getTime() - 24 * 3_600_000).toISOString();
    expect(shouldReplyToLockedUser(exactly24h, NOW)).toBe(true);
  });
  it("replies when last reply was much older", () => {
    const week = new Date(NOW.getTime() - 7 * 86_400_000).toISOString();
    expect(shouldReplyToLockedUser(week, NOW)).toBe(true);
  });
});

describe("pickPaymentAnchor", () => {
  it("anchors on current_period_ends_at when active and in the future (stacks)", () => {
    const r = row({
      status: "active",
      current_period_ends_at: "2026-06-01T00:00:00Z",
    });
    expect(pickPaymentAnchor(r, NOW).toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });
  it("anchors on current_period_ends_at when frozen with a future end", () => {
    const r = row({
      status: "frozen",
      current_period_ends_at: "2026-06-15T00:00:00Z",
      frozen_until: "2026-05-15T00:00:00Z",
    });
    expect(pickPaymentAnchor(r, NOW).toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });
  it("anchors on trial_ends_at when still in trial (don't waste trial days)", () => {
    const r = row({ status: "trial", trial_ends_at: "2026-05-11T00:00:00Z" });
    expect(pickPaymentAnchor(r, NOW).toISOString()).toBe("2026-05-11T00:00:00.000Z");
  });
  it("anchors at now when lapsed", () => {
    const r = row({
      status: "lapsed",
      current_period_ends_at: "2026-04-01T00:00:00Z",
    });
    expect(pickPaymentAnchor(r, NOW).getTime()).toBe(NOW.getTime());
  });
  it("anchors at now when trial_expired", () => {
    const r = row({ status: "trial_expired" });
    expect(pickPaymentAnchor(r, NOW).getTime()).toBe(NOW.getTime());
  });
  it("anchors at now when payment_failed", () => {
    const r = row({ status: "payment_failed" });
    expect(pickPaymentAnchor(r, NOW).getTime()).toBe(NOW.getTime());
  });
  it("anchors at now when active but period already past (cron didn't tick yet)", () => {
    const r = row({
      status: "active",
      current_period_ends_at: "2026-04-01T00:00:00Z",
    });
    expect(pickPaymentAnchor(r, NOW).getTime()).toBe(NOW.getTime());
  });
});

describe("canSendMedia", () => {
  it("permits trial / trial_ending / active / renewing_soon", () => {
    const ends = new Date("2026-06-01T12:00:00Z");
    expect(canSendMedia({ kind: "trial", daysLeft: 2, endsAt: ends })).toBe(true);
    expect(canSendMedia({ kind: "trial_ending", daysLeft: 1, endsAt: ends })).toBe(true);
    expect(canSendMedia({ kind: "active", renewsInDays: 10, endsAt: ends })).toBe(true);
    expect(canSendMedia({ kind: "renewing_soon", renewsInDays: 1, endsAt: ends })).toBe(true);
  });
  it("blocks trial_expired / lapsed / payment_failed / frozen", () => {
    expect(canSendMedia({ kind: "trial_expired" })).toBe(false);
    expect(canSendMedia({ kind: "lapsed" })).toBe(false);
    expect(canSendMedia({ kind: "payment_failed" })).toBe(false);
    expect(
      canSendMedia({
        kind: "frozen",
        untilDate: new Date("2026-06-01T12:00:00Z"),
      }),
    ).toBe(false);
  });
});
