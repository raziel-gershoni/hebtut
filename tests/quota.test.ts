import { describe, it, expect } from "vitest";
import { computeRemaining } from "@/server/quota";

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
