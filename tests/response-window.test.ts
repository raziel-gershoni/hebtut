import { describe, it, expect } from "vitest";
import { nextWindowOpen } from "@/server/response-window";

const TZ = "Asia/Jerusalem"; // UTC+2 in early May 2026 (or UTC+3 with DST — both fine for tests below since we anchor by tz-aware formatting)

function jerusalemUtc(local: string): Date {
  // Construct a UTC Date corresponding to Jerusalem-local `YYYY-MM-DDTHH:MM`.
  // Machine-tz-independent (matters: this test runs in CI in different tzs).
  // Uses a fixed +03:00 offset (DST is in effect in early May 2026).
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error(`bad local: ${local}`);
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]! - 3, +m[5]!));
}

describe("nextWindowOpen — same-day window 09:00–21:00", () => {
  it("returns null when inside the window", () => {
    const now = jerusalemUtc("2026-05-09T12:00");
    expect(nextWindowOpen(now, "09:00", "21:00", TZ)).toBeNull();
  });

  it("returns today's start when before the window", () => {
    const now = jerusalemUtc("2026-05-09T06:00");
    const next = nextWindowOpen(now, "09:00", "21:00", TZ);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBe(jerusalemUtc("2026-05-09T09:00").getTime());
  });

  it("returns tomorrow's start when after the window", () => {
    const now = jerusalemUtc("2026-05-09T22:00");
    const next = nextWindowOpen(now, "09:00", "21:00", TZ);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBe(jerusalemUtc("2026-05-10T09:00").getTime());
  });
});

describe("nextWindowOpen — overnight window 21:00–09:00", () => {
  it("returns null in the late-evening half", () => {
    const now = jerusalemUtc("2026-05-09T22:00");
    expect(nextWindowOpen(now, "21:00", "09:00", TZ)).toBeNull();
  });

  it("returns null in the early-morning half", () => {
    const now = jerusalemUtc("2026-05-09T06:00");
    expect(nextWindowOpen(now, "21:00", "09:00", TZ)).toBeNull();
  });

  it("returns today's 21:00 when in the daytime gap", () => {
    const now = jerusalemUtc("2026-05-09T14:00");
    const next = nextWindowOpen(now, "21:00", "09:00", TZ);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBe(jerusalemUtc("2026-05-09T21:00").getTime());
  });
});

describe("nextWindowOpen — degenerate / unset", () => {
  it("returns null when both fields are null (always allow)", () => {
    expect(nextWindowOpen(new Date(), null, null, TZ)).toBeNull();
  });
  it("returns null when only start is set", () => {
    expect(nextWindowOpen(new Date(), "09:00", null, TZ)).toBeNull();
  });
  it("returns null when only end is set", () => {
    expect(nextWindowOpen(new Date(), null, "21:00", TZ)).toBeNull();
  });
  it("treats start==end as always-on (returns null)", () => {
    expect(nextWindowOpen(new Date(), "09:00", "09:00", TZ)).toBeNull();
  });
});

// Regression — Postgres serializes `time` columns as "HH:MM:SS", and that
// shape used to silently fail the parser, which made every saved window
// behave like "always-on" once it round-tripped through the DB. Behaviour
// must match the bare "HH:MM" form exactly.
describe("nextWindowOpen — accepts the HH:MM:SS shape from Postgres", () => {
  it("matches HH:MM behaviour inside same-day window", () => {
    const now = jerusalemUtc("2026-05-09T12:00");
    expect(nextWindowOpen(now, "09:00:00", "21:00:00", TZ)).toBeNull();
  });
  it("matches HH:MM behaviour outside same-day window", () => {
    const now = jerusalemUtc("2026-05-09T06:00");
    const next = nextWindowOpen(now, "09:00:00", "21:00:00", TZ);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBe(jerusalemUtc("2026-05-09T09:00").getTime());
  });
  it("accepts mixed shapes on start and end", () => {
    const now = jerusalemUtc("2026-05-09T22:00");
    expect(nextWindowOpen(now, "21:00", "09:00:00", TZ)).toBeNull();
  });
});
