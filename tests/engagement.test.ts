import { describe, it, expect } from "vitest";
import {
  classifyInactivity,
  evaluateSlump,
  evaluatePlateau,
  median,
  computePracticeSignals,
  diffFlagStates,
  isGhosting,
  type ExistingFlag,
  type DesiredFlag,
} from "@/server/engagement";

describe("classifyInactivity", () => {
  it("maps day boundaries to tiers", () => {
    expect(classifyInactivity(0)).toBeNull();
    expect(classifyInactivity(1)).toBeNull();
    expect(classifyInactivity(2)).toBe("sliding");
    expect(classifyInactivity(6)).toBe("sliding");
    expect(classifyInactivity(7)).toBe("at_risk");
    expect(classifyInactivity(29)).toBe("at_risk");
    expect(classifyInactivity(30)).toBe("dormant");
    expect(classifyInactivity(365)).toBe("dormant");
  });
});

describe("evaluateSlump", () => {
  it("opens when current week < 50% of a substantial prior week", () => {
    expect(evaluateSlump(200, 600, false, false)).toBe(true);
  });
  it("does not open below the prior-week floor", () => {
    expect(evaluateSlump(100, 400, false, false)).toBe(false); // prior < 600s
  });
  it("does not open at exactly the ratio boundary", () => {
    expect(evaluateSlump(300, 600, false, false)).toBe(false); // not < 50%
  });
  it("holds open inside the hysteresis band", () => {
    expect(evaluateSlump(400, 600, true, false)).toBe(true); // 66% < 75% resolve bar
  });
  it("resolves above the hysteresis bar", () => {
    expect(evaluateSlump(450, 600, true, false)).toBe(false); // 75% reached
  });
  it("resolves an open flag when prior week is zero", () => {
    expect(evaluateSlump(0, 0, true, false)).toBe(false);
  });
  it("boundary just below the prior-week floor", () => {
    expect(evaluateSlump(200, 599, false, false)).toBe(false); // prior 599 < 600s floor
  });
  it("suppressed while inactive flag is open", () => {
    expect(evaluateSlump(200, 600, false, true)).toBe(false);
  });
});

describe("evaluatePlateau", () => {
  it("opens on a long streak of shallow days (absolute bar)", () => {
    expect(evaluatePlateau(10, 45, 60, false)).toBe(true); // < 90s
  });
  it("opens relative to own norm", () => {
    expect(evaluatePlateau(10, 100, 300, false)).toBe(true); // < 50% of 300
  });
  it("does not open without the streak", () => {
    expect(evaluatePlateau(6, 40, 200, false)).toBe(false);
  });
  it("does not open when practicing near own norm above the absolute bar", () => {
    expect(evaluatePlateau(10, 120, 130, false)).toBe(false);
  });
  it("holds open in the hysteresis band, resolves at 70% of norm", () => {
    expect(evaluatePlateau(10, 180, 300, true)).toBe(true); // 60% < 70%
    expect(evaluatePlateau(10, 210, 300, true)).toBe(false); // 70% reached
  });
  it("resolves when the streak breaks", () => {
    expect(evaluatePlateau(3, 40, 200, true)).toBe(false);
  });
  it("stays open (no flap) when resolve bar is above the open bar due to absolute floor", () => {
    // median30=100: open bar = max(90, 0.5*100)=90; old resolve bar = 0.7*100=70 (inversion!).
    // Fixed resolve bar = max(90, 0.7*100)=90. median7=85 < 90 → stays open.
    expect(evaluatePlateau(10, 85, 100, true)).toBe(true); // open, median7 85 < max(90,70)=90
    // Verify same scenario opens when closed.
    expect(evaluatePlateau(10, 85, 100, false)).toBe(true); // 85 < max(90,50)=90
  });
});

describe("median", () => {
  it("handles empty, odd, even", () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([1, 3, 9])).toBe(3);
    expect(median([1, 3, 5, 9])).toBe(4);
  });
});

describe("computePracticeSignals", () => {
  // Helper to build a seconds-by-date map: entries are [daysAgo, seconds].
  const today = "2026-06-11";
  function days(entries: [number, number][]): Map<string, number> {
    const m = new Map<string, number>();
    for (const [ago, s] of entries) {
      const d = new Date(Date.UTC(2026, 5, 11));
      d.setUTCDate(d.getUTCDate() - ago);
      m.set(d.toISOString().slice(0, 10), s);
    }
    return m;
  }

  it("computes daysSinceAnchor from the last practiced day", () => {
    const s = computePracticeSignals(days([[3, 120]]), today, null);
    expect(s.daysSinceAnchor).toBe(3);
  });

  it("ignores sub-threshold days for the anchor", () => {
    const s = computePracticeSignals(days([[1, 10], [4, 120]]), today, null);
    expect(s.daysSinceAnchor).toBe(4);
  });

  it("falls back to the provided anchor when never practiced", () => {
    const s = computePracticeSignals(days([]), today, "2026-06-08");
    expect(s.daysSinceAnchor).toBe(3);
  });

  it("returns null daysSinceAnchor with no practice and no fallback", () => {
    const s = computePracticeSignals(days([]), today, null);
    expect(s.daysSinceAnchor).toBeNull();
  });

  it("practiced today yields daysSinceAnchor === 0", () => {
    const s = computePracticeSignals(days([[0, 120]]), today, null);
    expect(s.daysSinceAnchor).toBe(0);
  });

  it("sums current (d0..d6) and prior (d7..d13) week seconds", () => {
    const s = computePracticeSignals(days([[1, 100], [6, 50], [7, 200], [13, 40]]), today, null);
    expect(s.currentWeekS).toBe(150);
    expect(s.priorWeekS).toBe(240);
  });

  it("computes streak (today optional) and medians over practiced days", () => {
    const s = computePracticeSignals(
      days([[1, 60], [2, 60], [3, 90], [4, 120], [5, 60], [6, 60], [7, 60]]),
      today,
      null,
    );
    expect(s.streak).toBe(7);
    expect(s.median7).toBe(60);
    expect(s.median30).toBe(60);
  });
});

describe("diffFlagStates", () => {
  const open = (kind: string, tier: string | null = null): ExistingFlag =>
    ({ kind, tier } as ExistingFlag);
  const want = (kind: string, tier: string | null = null): DesiredFlag =>
    ({ kind, tier, meta: {} } as DesiredFlag);

  it("opens new, resolves gone, ignores unchanged", () => {
    const t = diffFlagStates([open("slump")], [want("ghosting")]);
    expect(t).toEqual([
      { type: "open", kind: "ghosting", tier: null, meta: {} },
      { type: "resolve", kind: "slump" },
    ]);
  });

  it("escalates on inactive tier change", () => {
    const t = diffFlagStates([open("inactive", "sliding")], [want("inactive", "at_risk")]);
    expect(t).toEqual([{ type: "escalate", kind: "inactive", tier: "at_risk", meta: {} }]);
  });

  it("emits nothing when state matches", () => {
    expect(diffFlagStates([open("inactive", "sliding")], [want("inactive", "sliding")])).toEqual([]);
  });
  it("tier DOWNGRADE also emits escalate (contract pin)", () => {
    // dormant → at_risk is a downgrade but the contract says any tier change = escalate.
    const t = diffFlagStates([open("inactive", "dormant")], [want("inactive", "at_risk")]);
    expect(t).toEqual([{ type: "escalate", kind: "inactive", tier: "at_risk", meta: {} }]);
  });
});

describe("isGhosting", () => {
  it("fires when tutor replied and student hasn't replied past the threshold", () => {
    // outT=100ms, inT=50ms (tutor last), gap=60ms >= threshold 50ms
    expect(isGhosting(100, 50, 160, 50)).toBe(true);
  });
  it("suppressed when student has never replied (inT=0)", () => {
    expect(isGhosting(100, 0, 200, 50)).toBe(false);
  });
  it("suppressed when gap is below the threshold", () => {
    // gap = 160 - 100 = 60ms, threshold = 70ms
    expect(isGhosting(100, 50, 160, 70)).toBe(false);
  });
});
