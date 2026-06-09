import { describe, it, expect } from "vitest";
import {
  computeRemaining,
  decideQuota,
  computeSignedRemaining,
  groupUserIdsByTz,
  computeSignedRemainingMap,
} from "@/server/quota";

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

  it("accepts the first message that crosses into grace, charging full duration today + the overflow tomorrow", () => {
    expect(
      decideQuota({
        usedToday: 280,
        dailyQuota: QUOTA,
        graceSeconds: GRACE,
        messageDuration: 50,
      }),
    ).toEqual({
      ok: true,
      todayDebit: 50,
      tomorrowDebit: 30,
      newRemainingToday: 0,
    });
  });

  it("accepts a grace-only message starting exactly at the quota line", () => {
    expect(
      decideQuota({
        usedToday: 300,
        dailyQuota: QUOTA,
        graceSeconds: GRACE,
        messageDuration: 40,
      }),
    ).toEqual({
      ok: true,
      todayDebit: 40,
      tomorrowDebit: 40,
      newRemainingToday: 0,
    });
  });

  it("locks out further messages once grace has been used today", () => {
    // After accepting an overflow message, usedToday lands above dailyQuota.
    // Any subsequent message — even a tiny one — must be rejected with no
    // remaining room, regardless of how much grace would technically be left.
    expect(
      decideQuota({
        usedToday: 330,
        dailyQuota: QUOTA,
        graceSeconds: GRACE,
        messageDuration: 5,
      }),
    ).toEqual({ ok: false, reason: "no-room", remainingIncludingGrace: 0 });
  });

  it("rejects a long message that would push past quota+grace combined", () => {
    // User's example: usedToday=250, msg=140 → 250 + 140 = 390 > 360.
    // Grace is untouched, the rejection just shows the actual headroom.
    expect(
      decideQuota({
        usedToday: 250,
        dailyQuota: QUOTA,
        graceSeconds: GRACE,
        messageDuration: 140,
      }),
    ).toEqual({ ok: false, reason: "no-room", remainingIncludingGrace: 110 });
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

describe("computeSignedRemaining", () => {
  it("returns full cap when no usage", () => {
    expect(computeSignedRemaining(0, 300)).toBe(300);
  });
  it("subtracts used seconds (positive remaining)", () => {
    expect(computeSignedRemaining(120, 300)).toBe(180);
  });
  it("returns zero when usage equals cap", () => {
    expect(computeSignedRemaining(300, 300)).toBe(0);
  });
  it("returns NEGATIVE when over (no clamping — unlike computeRemaining)", () => {
    expect(computeSignedRemaining(345, 300)).toBe(-45);
  });
});

describe("groupUserIdsByTz", () => {
  it("returns empty map for empty input", () => {
    expect(groupUserIdsByTz([], new Map())).toEqual(new Map());
  });

  it("groups all ids under a single tz when all share it", () => {
    const tzByUser = new Map([
      [1, "Europe/Moscow"],
      [2, "Europe/Moscow"],
      [3, "Europe/Moscow"],
    ]);
    const result = groupUserIdsByTz([1, 2, 3], tzByUser);
    expect(result.size).toBe(1);
    expect(result.get("Europe/Moscow")).toEqual([1, 2, 3]);
  });

  it("creates one bucket per distinct tz", () => {
    const tzByUser = new Map([
      [1, "Europe/Moscow"],
      [2, "Asia/Tokyo"],
      [3, "Europe/Moscow"],
      [4, "Asia/Tokyo"],
    ]);
    const result = groupUserIdsByTz([1, 2, 3, 4], tzByUser);
    expect(result.size).toBe(2);
    expect(result.get("Europe/Moscow")).toEqual([1, 3]);
    expect(result.get("Asia/Tokyo")).toEqual([2, 4]);
  });

  it("defaults missing tz entries to UTC", () => {
    const tzByUser = new Map([[1, "Europe/Moscow"]]);
    const result = groupUserIdsByTz([1, 2, 3], tzByUser);
    expect(result.get("Europe/Moscow")).toEqual([1]);
    expect(result.get("UTC")).toEqual([2, 3]);
  });
});

describe("computeSignedRemainingMap", () => {
  it("returns full cap for users with no usage entry", () => {
    const result = computeSignedRemainingMap([1, 2], new Map(), 300);
    expect(result.get(1)).toBe(300);
    expect(result.get(2)).toBe(300);
  });

  it("subtracts known usage", () => {
    const usedByUser = new Map([[1, 100]]);
    const result = computeSignedRemainingMap([1, 2], usedByUser, 300);
    expect(result.get(1)).toBe(200);
    expect(result.get(2)).toBe(300);
  });

  it("returns negative when usage > cap (over)", () => {
    const usedByUser = new Map([[1, 345]]);
    const result = computeSignedRemainingMap([1], usedByUser, 300);
    expect(result.get(1)).toBe(-45);
  });

  it("returns exactly 0 when usage equals cap", () => {
    const usedByUser = new Map([[1, 300]]);
    const result = computeSignedRemainingMap([1], usedByUser, 300);
    expect(result.get(1)).toBe(0);
  });
});
