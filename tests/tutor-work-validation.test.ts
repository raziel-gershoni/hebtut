import { describe, it, expect } from "vitest";
import { validatePlayback, type PlaybackInput } from "@/server/tutor-work-validation";

const t = (s: number) => new Date(s * 1000);

const baseMessage = {
  id: 100,
  direction: "in" as const,
  kind: "voice" as const,
  duration: 30,
  student_id: 7,
};

const baseActiveWindow = [{ started_at: t(0), ended_at: t(60) }];

const validInput: PlaybackInput = {
  message: baseMessage,
  tutorIsLinkedToStudent: true,
  activeWindows: baseActiveWindow,
  started_at: t(5),
  ended_at: t(20),
};

describe("validatePlayback", () => {
  it("accepts a valid playback within an active window", () => {
    const r = validatePlayback(validInput);
    expect(r).toEqual({
      ok: true,
      student_id: 7,
      started_at: t(5),
      ended_at: t(20),
    });
  });

  it("rejects when no overlapping active heartbeat", () => {
    const r = validatePlayback({ ...validInput, activeWindows: [] });
    expect(r).toEqual({ ok: false, reason: "no-active-overlap" });
  });

  it("rejects when message is outbound (not inbound from student)", () => {
    const r = validatePlayback({
      ...validInput,
      message: { ...baseMessage, direction: "out" },
    });
    expect(r).toEqual({ ok: false, reason: "outbound-message" });
  });

  it("rejects when tutor not linked to student", () => {
    const r = validatePlayback({ ...validInput, tutorIsLinkedToStudent: false });
    expect(r).toEqual({ ok: false, reason: "not-linked" });
  });

  it("rejects when message kind is text (not voice/video_note)", () => {
    const r = validatePlayback({
      ...validInput,
      // @ts-expect-error — testing runtime guard
      message: { ...baseMessage, kind: "text" },
    });
    expect(r).toEqual({ ok: false, reason: "not-playable" });
  });

  it("clamps duration when claimed > message duration", () => {
    const r = validatePlayback({
      ...validInput,
      started_at: t(0),
      ended_at: t(50), // claim 50s on a 30s file
    });
    expect(r).toEqual({
      ok: true,
      student_id: 7,
      started_at: t(0),
      ended_at: t(30),
    });
  });

  it("rejects when ended_at < started_at", () => {
    const r = validatePlayback({
      ...validInput,
      started_at: t(20),
      ended_at: t(10),
    });
    expect(r).toEqual({ ok: false, reason: "invalid-range" });
  });
});
