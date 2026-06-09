import { describe, it, expect } from "vitest";
import {
  mergeIntervals,
  subtractIntervals,
  intervalsDurationS,
  computeWorkBuckets,
  applyDailyCap,
  type Interval,
} from "@/server/tutor-work";

const iv = (start: number, end: number): Interval => ({ start, end });

describe("mergeIntervals", () => {
  it("empty → empty", () => {
    expect(mergeIntervals([])).toEqual([]);
  });
  it("single → single", () => {
    expect(mergeIntervals([iv(0, 10)])).toEqual([iv(0, 10)]);
  });
  it("two disjoint → both", () => {
    expect(mergeIntervals([iv(0, 5), iv(10, 15)])).toEqual([iv(0, 5), iv(10, 15)]);
  });
  it("two touching at boundary → merged", () => {
    expect(mergeIntervals([iv(0, 5), iv(5, 10)])).toEqual([iv(0, 10)]);
  });
  it("two overlapping → merged with max end", () => {
    expect(mergeIntervals([iv(0, 7), iv(5, 10)])).toEqual([iv(0, 10)]);
  });
  it("three with chain merge → single", () => {
    expect(mergeIntervals([iv(0, 5), iv(3, 8), iv(7, 12)])).toEqual([iv(0, 12)]);
  });
  it("unsorted input → still correct", () => {
    expect(mergeIntervals([iv(10, 15), iv(0, 5), iv(20, 25)])).toEqual([
      iv(0, 5),
      iv(10, 15),
      iv(20, 25),
    ]);
  });
  it("zero-length interval → dropped", () => {
    expect(mergeIntervals([iv(5, 5), iv(0, 10)])).toEqual([iv(0, 10)]);
  });
  it("does not mutate input", () => {
    const a = iv(0, 5);
    const b = iv(3, 8);
    mergeIntervals([a, b]);
    expect(a).toEqual({ start: 0, end: 5 });
    expect(b).toEqual({ start: 3, end: 8 });
  });
});

describe("subtractIntervals", () => {
  it("empty base → empty", () => {
    expect(subtractIntervals([], [iv(0, 5)])).toEqual([]);
  });
  it("empty toRemove → base unchanged", () => {
    expect(subtractIntervals([iv(0, 10)], [])).toEqual([iv(0, 10)]);
  });
  it("toRemove fully covers base → empty", () => {
    expect(subtractIntervals([iv(2, 8)], [iv(0, 10)])).toEqual([]);
  });
  it("partial overlap at start → trimmed left", () => {
    expect(subtractIntervals([iv(5, 15)], [iv(0, 8)])).toEqual([iv(8, 15)]);
  });
  it("partial overlap at end → trimmed right", () => {
    expect(subtractIntervals([iv(0, 10)], [iv(7, 15)])).toEqual([iv(0, 7)]);
  });
  it("toRemove inside base → base split into two", () => {
    expect(subtractIntervals([iv(0, 20)], [iv(5, 10)])).toEqual([
      iv(0, 5),
      iv(10, 20),
    ]);
  });
  it("multiple holes punched", () => {
    expect(
      subtractIntervals([iv(0, 30)], [iv(5, 10), iv(15, 20)]),
    ).toEqual([iv(0, 5), iv(10, 15), iv(20, 30)]);
  });
  it("disjoint toRemove → base unchanged", () => {
    expect(subtractIntervals([iv(10, 20)], [iv(0, 5), iv(25, 30)])).toEqual([
      iv(10, 20),
    ]);
  });
});

describe("intervalsDurationS", () => {
  it("empty → 0", () => {
    expect(intervalsDurationS([])).toBe(0);
  });
  it("sums lengths in seconds", () => {
    expect(intervalsDurationS([iv(0, 5000), iv(10000, 15000)])).toBe(10);
  });
});

describe("computeWorkBuckets", () => {
  const t = (s: number) => new Date(s * 1000);
  const ev = (kind: "active" | "playback" | "recording", from: number, to: number) => ({
    kind,
    started_at: t(from),
    ended_at: t(to),
  });

  it("all empty → all zeros", () => {
    expect(computeWorkBuckets([])).toEqual({
      recording_s: 0,
      playback_s: 0,
      active_s: 0,
      total_s: 0,
    });
  });
  it("recording only → recording_s = total", () => {
    const r = computeWorkBuckets([ev("recording", 0, 30)]);
    expect(r).toEqual({ recording_s: 30, playback_s: 0, active_s: 0, total_s: 30 });
  });
  it("playback only → playback_s = total", () => {
    const r = computeWorkBuckets([ev("playback", 0, 45)]);
    expect(r).toEqual({ recording_s: 0, playback_s: 45, active_s: 0, total_s: 45 });
  });
  it("active only → active_s = total", () => {
    const r = computeWorkBuckets([ev("active", 0, 60)]);
    expect(r).toEqual({ recording_s: 0, playback_s: 0, active_s: 60, total_s: 60 });
  });
  it("playback overlaps active → active = playback-free remainder", () => {
    const r = computeWorkBuckets([ev("active", 0, 60), ev("playback", 10, 30)]);
    expect(r).toEqual({ recording_s: 0, playback_s: 20, active_s: 40, total_s: 60 });
  });
  it("recording overlaps playback → playback = recording-free remainder", () => {
    const r = computeWorkBuckets([ev("playback", 0, 30), ev("recording", 10, 20)]);
    expect(r).toEqual({ recording_s: 10, playback_s: 20, active_s: 0, total_s: 30 });
  });
  it("ladder: active 0-60, playback 30-45, recording 40-42", () => {
    const r = computeWorkBuckets([
      ev("active", 0, 60),
      ev("playback", 30, 45),
      ev("recording", 40, 42),
    ]);
    expect(r).toEqual({ recording_s: 2, playback_s: 13, active_s: 45, total_s: 60 });
  });
});

describe("applyDailyCap", () => {
  it("no clamp when under cap", () => {
    expect(
      applyDailyCap(
        { recording_s: 100, playback_s: 200, active_s: 300, total_s: 600 },
        16 * 3600,
      ),
    ).toEqual({ recording_s: 100, playback_s: 200, active_s: 300, total_s: 600 });
  });
  it("clamps total proportionally when over cap", () => {
    const r = applyDailyCap(
      { recording_s: 1000, playback_s: 2000, active_s: 7000, total_s: 10000 },
      5000,
    );
    expect(r.total_s).toBe(5000);
    expect(r.recording_s + r.playback_s + r.active_s).toBe(5000);
    expect(r.recording_s).toBe(500);
    expect(r.playback_s).toBe(1000);
    expect(r.active_s).toBe(3500);
  });
  it("never returns negative active_s on rounding edge", () => {
    const r = applyDailyCap(
      { recording_s: 1000, playback_s: 1000, active_s: 0, total_s: 2000 },
      1999,
    );
    expect(r.active_s).toBeGreaterThanOrEqual(0);
    expect(r.total_s).toBe(1999);
  });
});
