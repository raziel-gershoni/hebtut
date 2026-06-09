export type PlaybackInput = {
  message: {
    id: number;
    direction: "in" | "out";
    kind: "voice" | "video_note" | "text";
    duration: number;
    student_id: number;
  } | null;
  tutorIsLinkedToStudent: boolean;
  activeWindows: { started_at: Date; ended_at: Date }[];
  started_at: Date;
  ended_at: Date;
};

export type PlaybackResult =
  | { ok: true; student_id: number; started_at: Date; ended_at: Date }
  | {
      ok: false;
      reason:
        | "no-message"
        | "outbound-message"
        | "not-playable"
        | "not-linked"
        | "invalid-range"
        | "no-active-overlap";
    };

export function validatePlayback(input: PlaybackInput): PlaybackResult {
  const { message, tutorIsLinkedToStudent, activeWindows, started_at } = input;

  if (!message) return { ok: false, reason: "no-message" };
  if (message.direction !== "in") return { ok: false, reason: "outbound-message" };
  if (message.kind !== "voice" && message.kind !== "video_note") {
    return { ok: false, reason: "not-playable" };
  }
  if (!tutorIsLinkedToStudent) return { ok: false, reason: "not-linked" };

  if (input.ended_at.getTime() < started_at.getTime()) {
    return { ok: false, reason: "invalid-range" };
  }

  const claimedMs = input.ended_at.getTime() - started_at.getTime();
  const maxMs = message.duration * 1000;
  const ended_at = claimedMs > maxMs
    ? new Date(started_at.getTime() + maxMs)
    : input.ended_at;

  const hasOverlap = activeWindows.some(
    (w) =>
      w.ended_at.getTime() > started_at.getTime() &&
      w.started_at.getTime() < ended_at.getTime(),
  );
  if (!hasOverlap) return { ok: false, reason: "no-active-overlap" };

  return { ok: true, student_id: message.student_id, started_at, ended_at };
}
