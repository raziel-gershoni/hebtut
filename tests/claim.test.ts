import { describe, it, expect } from "vitest";
import { canClaim } from "@/server/claim";

describe("canClaim", () => {
  it("allows pending → claimed", () => {
    expect(canClaim({ status: "pending", claimed_by_teacher_id: null }, 7)).toBe(true);
  });
  it("rejects already claimed by another teacher", () => {
    expect(canClaim({ status: "claimed", claimed_by_teacher_id: 9 }, 7)).toBe(false);
  });
  it("allows the same teacher reclaiming their own", () => {
    expect(canClaim({ status: "claimed", claimed_by_teacher_id: 7 }, 7)).toBe(true);
  });
  it("rejects answered/expired/orphaned", () => {
    expect(canClaim({ status: "answered", claimed_by_teacher_id: null }, 7)).toBe(false);
    expect(canClaim({ status: "expired", claimed_by_teacher_id: null }, 7)).toBe(false);
    expect(canClaim({ status: "orphaned", claimed_by_teacher_id: null }, 7)).toBe(false);
  });
});
