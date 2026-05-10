import { describe, it, expect } from "vitest";
import { computeOnboardingDay, nextSafeFireTime } from "@/server/onboarding";

const TZ = "Asia/Jerusalem"; // UTC+3 in May (DST)

function jerusalemUtc(local: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error(`bad local: ${local}`);
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]! - 3, +m[5]!));
}

describe("computeOnboardingDay", () => {
  it("returns 1 on the same calendar day as trial start (tz-anchored)", () => {
    const start = jerusalemUtc("2026-05-10T09:00").toISOString();
    const now = jerusalemUtc("2026-05-10T22:00");
    expect(computeOnboardingDay(start, now, TZ)).toBe(1);
  });

  it("returns 2 the next calendar day, even when only minutes have passed", () => {
    // Trial started at 23:50 Jerusalem; ten minutes later is 00:00 next day.
    const start = jerusalemUtc("2026-05-10T23:50").toISOString();
    const now = jerusalemUtc("2026-05-11T00:00");
    expect(computeOnboardingDay(start, now, TZ)).toBe(2);
  });

  it("returns 3 on day 3", () => {
    const start = jerusalemUtc("2026-05-10T09:00").toISOString();
    const now = jerusalemUtc("2026-05-12T09:00");
    expect(computeOnboardingDay(start, now, TZ)).toBe(3);
  });

  it("returns 6 five days later", () => {
    const start = jerusalemUtc("2026-05-01T12:00").toISOString();
    const now = jerusalemUtc("2026-05-06T12:00");
    expect(computeOnboardingDay(start, now, TZ)).toBe(6);
  });

  it("clamps to 1 if the clock somehow runs backwards (paranoia)", () => {
    const start = jerusalemUtc("2026-05-10T09:00").toISOString();
    const now = jerusalemUtc("2026-05-08T09:00");
    expect(computeOnboardingDay(start, now, TZ)).toBe(1);
  });

  it("respects student tz — UTC date may differ from local date", () => {
    // Trial start is 23:00 UTC on May 10 = 02:00 local on May 11 in Jerusalem.
    // 'now' at 04:00 UTC on May 11 = 07:00 local on May 11 — same local day.
    const start = "2026-05-10T23:00:00.000Z";
    const now = new Date("2026-05-11T04:00:00.000Z");
    expect(computeOnboardingDay(start, now, TZ)).toBe(1);
  });
});

describe("nextSafeFireTime", () => {
  it("returns due unchanged when inside the student's window", () => {
    const due = jerusalemUtc("2026-05-10T14:00");
    const next = nextSafeFireTime(due, "09:00", "21:00", TZ);
    expect(next.getTime()).toBe(due.getTime());
  });

  it("defers a 03:00 fire to today's window opening (09:00) when window is set", () => {
    const due = jerusalemUtc("2026-05-10T03:00");
    const next = nextSafeFireTime(due, "09:00", "21:00", TZ);
    expect(next.getTime()).toBe(jerusalemUtc("2026-05-10T09:00").getTime());
  });

  it("defers a late-night fire (23:30) to tomorrow's window opening", () => {
    const due = jerusalemUtc("2026-05-10T23:30");
    const next = nextSafeFireTime(due, "09:00", "21:00", TZ);
    expect(next.getTime()).toBe(jerusalemUtc("2026-05-11T09:00").getTime());
  });

  it("uses the 08:00–22:00 fallback when student has no window set", () => {
    const due = jerusalemUtc("2026-05-10T03:00");
    const next = nextSafeFireTime(due, null, null, TZ);
    expect(next.getTime()).toBe(jerusalemUtc("2026-05-10T08:00").getTime());
  });

  it("returns due unchanged when fallback window covers the time", () => {
    const due = jerusalemUtc("2026-05-10T15:00");
    const next = nextSafeFireTime(due, null, null, TZ);
    expect(next.getTime()).toBe(due.getTime());
  });

  it("supports overnight windows (21:00–09:00)", () => {
    // Due 14:00 (in the daytime gap) → defer to today's 21:00 opening.
    const due = jerusalemUtc("2026-05-10T14:00");
    const next = nextSafeFireTime(due, "21:00", "09:00", TZ);
    expect(next.getTime()).toBe(jerusalemUtc("2026-05-10T21:00").getTime());
  });
});
