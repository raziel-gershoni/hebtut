import { describe, it, expect } from "vitest";
import { apportionMinutes } from "@/server/tutor-work";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const floorTotalMin = (parts: number[]) => Math.floor(sum(parts) / 60);

describe("apportionMinutes", () => {
  it("the reported bug: 0+0+5 must not undershoot a 7м total", () => {
    // active 59s, playback 59s, recording 359s → 477s total = 7м floored.
    // Independent flooring gives [0,0,5] = 5м, mismatching the 7м total.
    const parts = [59, 59, 359];
    const out = apportionMinutes(parts);
    expect(sum(out)).toBe(7);
    expect(out).toEqual([1, 1, 5]); // two leftover minutes → two largest remainders
  });

  it("parts already on minute boundaries pass through unchanged", () => {
    expect(apportionMinutes([120, 180, 300])).toEqual([2, 3, 5]);
  });

  it("distributes a single leftover minute to the largest remainder (ties → left)", () => {
    // 90+90+90 = 270s = 4м; floors [1,1,1]=3; one minute to the first tie.
    expect(apportionMinutes([90, 90, 90])).toEqual([2, 1, 1]);
  });

  it("all zero → all zero", () => {
    expect(apportionMinutes([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("invariant: apportioned minutes always re-sum to floor(total/60)", () => {
    const cases = [
      [0, 0, 0],
      [59, 59, 359],
      [1, 2, 3],
      [3599, 1, 60],
      [12345, 6789, 101],
      [40, 50, 320],
    ];
    for (const parts of cases) {
      expect(sum(apportionMinutes(parts))).toBe(floorTotalMin(parts));
    }
  });
});
