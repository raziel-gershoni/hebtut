import { describe, it, expect } from "vitest";
import { userHandle, bgFromHandle } from "@/lib/handle";

describe("userHandle", () => {
  it("is deterministic across repeat calls", () => {
    const a = userHandle(123456);
    const b = userHandle(123456);
    expect(a).toEqual(b);
  });

  it("returns a two-word handle, an emoji, and a tailwind bg class", () => {
    const r = userHandle(987654321);
    expect(r.handle).toMatch(/^\S+ \S+$/);
    expect(r.emoji.length).toBeGreaterThan(0);
    expect(r.bgClass).toMatch(/^bg-[a-z]+-\d{3}\/\d+$/);
  });

  it("spreads sequential ids across the palette (varied output)", () => {
    const handles = new Set<string>();
    const emojis = new Set<string>();
    for (let i = 1; i <= 30; i++) {
      const r = userHandle(i);
      handles.add(r.handle);
      emojis.add(r.emoji);
    }
    // Not perfect uniqueness, but a healthy spread — not all 30 collapsing to one.
    expect(handles.size).toBeGreaterThan(20);
    expect(emojis.size).toBeGreaterThan(10);
  });

  it("accepts string ids identically to numeric (matches DB driver casing)", () => {
    expect(userHandle(42)).toEqual(userHandle("42"));
  });
});

describe("bgFromHandle", () => {
  it("is deterministic per handle", () => {
    expect(bgFromHandle("Смелый Лев")).toBe(bgFromHandle("Смелый Лев"));
  });

  it("returns one of the seven palette classes", () => {
    expect(bgFromHandle("Шустрый Енот")).toMatch(/^bg-[a-z]+-500\/20$/);
  });
});
