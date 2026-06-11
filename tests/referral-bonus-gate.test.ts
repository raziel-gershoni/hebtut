import { describe, it, expect } from "vitest";
import { shouldApplyReferralBonus } from "@/server/subscriptions";

describe("shouldApplyReferralBonus", () => {
  it("applies when enabled, first paid period, and a referrer exists", () => {
    expect(shouldApplyReferralBonus(true, true, 42)).toBe(true);
  });

  it("does NOT apply when referrals are disabled", () => {
    expect(shouldApplyReferralBonus(false, true, 42)).toBe(false);
  });

  it("does NOT apply when it is not the first paid period", () => {
    expect(shouldApplyReferralBonus(true, false, 42)).toBe(false);
  });

  it("does NOT apply when there is no referrer", () => {
    expect(shouldApplyReferralBonus(true, true, null)).toBe(false);
  });
});
