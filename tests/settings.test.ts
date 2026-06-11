import { describe, it, expect } from "vitest";
import { resolveSettingRead } from "@/server/settings";

describe("resolveSettingRead", () => {
  it("returns the row value and caches it on a clean read", () => {
    expect(resolveSettingRead(undefined, { value: true }, null)).toEqual({
      value: true,
      cacheable: true,
    });
  });

  it("treats an absent row as false and caches it", () => {
    expect(resolveSettingRead(undefined, null, null)).toEqual({
      value: false,
      cacheable: true,
    });
  });

  it("treats a non-boolean value as false and caches it", () => {
    expect(resolveSettingRead(undefined, { value: "true" }, null)).toEqual({
      value: false,
      cacheable: true,
    });
  });

  it("falls back to the stale cached value on a read error, without caching", () => {
    expect(
      resolveSettingRead(true, null, { message: "fetch failed" }),
    ).toEqual({ value: true, cacheable: false });
  });

  it("preserves a stale false on a read error too", () => {
    expect(
      resolveSettingRead(false, null, { message: "fetch failed" }),
    ).toEqual({ value: false, cacheable: false });
  });

  it("fails closed (false) on a read error with a cold cache, without caching", () => {
    expect(
      resolveSettingRead(undefined, null, { message: "fetch failed" }),
    ).toEqual({ value: false, cacheable: false });
  });
});
