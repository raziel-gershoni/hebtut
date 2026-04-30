import { describe, it, expect } from "vitest";
import { computeRemaining, decideQuota } from "@/server/quota";

describe("computeRemaining", () => {
  it("returns full budget when no usage", () => {
    expect(computeRemaining(0, 300)).toBe(300);
  });
  it("subtracts used seconds", () => {
    expect(computeRemaining(120, 300)).toBe(180);
  });
  it("clamps at zero when over", () => {
    expect(computeRemaining(400, 300)).toBe(0);
  });
});

describe("decideQuota", () => {
  const QUOTA = 300;
  const GRACE = 60;

  it("accepts a message that fits within today's quota — no carry", () => {
    expect(
      decideQuota({
        usedToday: 100,
        dailyQuota: QUOTA,
        graceSeconds: GRACE,
        messageDuration: 50,
      }),
    ).toEqual({
      ok: true,
      todayDebit: 50,
      tomorrowDebit: 0,
      newRemainingToday: 150,
    });
  });

  it("accepts exactly at the boundary, leaving zero remaining and no carry", () => {
    expect(
      decideQuota({
        usedToday: 250,
        dailyQuota: QUOTA,
        graceSeconds: GRACE,
        messageDuration: 50,
      }),
    ).toEqual({
      ok: true,
      todayDebit: 50,
      tomorrowDebit: 0,
      newRemainingToday: 0,
    });
  });

  it("splits across today + tomorrow when the tail crosses into grace", () => {
    expect(
      decideQuota({
        usedToday: 280,
        dailyQuota: QUOTA,
        graceSeconds: GRACE,
        messageDuration: 50,
      }),
    ).toEqual({
      ok: true,
      todayDebit: 20,
      tomorrowDebit: 30,
      newRemainingToday: 0,
    });
  });

  it("charges the whole message to tomorrow when today's quota is fully spent", () => {
    expect(
      decideQuota({
        usedToday: 300,
        dailyQuota: QUOTA,
        graceSeconds: GRACE,
        messageDuration: 40,
      }),
    ).toEqual({
      ok: true,
      todayDebit: 0,
      tomorrowDebit: 40,
      newRemainingToday: 0,
    });
  });

  it("rejects a message that would exceed quota+grace combined", () => {
    expect(
      decideQuota({
        usedToday: 320,
        dailyQuota: QUOTA,
        graceSeconds: GRACE,
        messageDuration: 50,
      }),
    ).toEqual({ ok: false, reason: "no-room", remainingIncludingGrace: 40 });
  });

  it("rejects when grace is fully consumed too", () => {
    expect(
      decideQuota({
        usedToday: 360,
        dailyQuota: QUOTA,
        graceSeconds: GRACE,
        messageDuration: 5,
      }),
    ).toEqual({ ok: false, reason: "no-room", remainingIncludingGrace: 0 });
  });

  it("with grace=0 falls back to plain quota semantics", () => {
    expect(
      decideQuota({
        usedToday: 250,
        dailyQuota: QUOTA,
        graceSeconds: 0,
        messageDuration: 60,
      }),
    ).toEqual({ ok: false, reason: "no-room", remainingIncludingGrace: 50 });
  });
});
