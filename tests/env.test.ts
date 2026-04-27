import { describe, it, expect } from "vitest";
import { parseAdminIds } from "@/lib/env";

describe("parseAdminIds", () => {
  it("parses a single id", () => {
    expect(parseAdminIds("12345")).toEqual([12345]);
  });

  it("parses a comma-separated list", () => {
    expect(parseAdminIds("12345,67890")).toEqual([12345, 67890]);
  });

  it("trims whitespace and dedupes while preserving order", () => {
    expect(parseAdminIds(" 1 , 2 , 1 ")).toEqual([1, 2]);
  });

  it("rejects non-integer entries", () => {
    expect(() => parseAdminIds("12345,abc")).toThrow();
  });

  it("rejects zero / negative values", () => {
    expect(() => parseAdminIds("0,1")).toThrow();
    expect(() => parseAdminIds("-5")).toThrow();
  });

  it("rejects empty / whitespace-only input", () => {
    expect(() => parseAdminIds("")).toThrow();
    expect(() => parseAdminIds(" , , ")).toThrow();
  });
});
