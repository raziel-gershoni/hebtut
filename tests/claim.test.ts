import { describe, it, expect } from "vitest";
import { decideReplyKind } from "@/server/claim";

const ME = 7;
const OTHER = 99;

describe("decideReplyKind", () => {
  it("rejects outbound messages", () => {
    expect(
      decideReplyKind({
        msgDirection: "out",
        msgStatus: "answered",
        activeClaimTeacherId: null,
        teacherId: ME,
      }),
    ).toEqual({ ok: false, reason: "outbound" });
  });

  it("rejects orphaned messages", () => {
    expect(
      decideReplyKind({
        msgDirection: "in",
        msgStatus: "orphaned",
        activeClaimTeacherId: null,
        teacherId: ME,
      }),
    ).toEqual({ ok: false, reason: "orphaned" });
  });

  it("rejects when another teacher holds an active claim on the student", () => {
    expect(
      decideReplyKind({
        msgDirection: "in",
        msgStatus: "pending",
        activeClaimTeacherId: OTHER,
        teacherId: ME,
      }),
    ).toEqual({ ok: false, reason: "taken-by-other" });
  });

  it("returns 'claim' for pending with no active claim", () => {
    expect(
      decideReplyKind({
        msgDirection: "in",
        msgStatus: "pending",
        activeClaimTeacherId: null,
        teacherId: ME,
      }),
    ).toEqual({ ok: true, kind: "claim" });
  });

  it("returns 'claim' for expired with no active claim", () => {
    expect(
      decideReplyKind({
        msgDirection: "in",
        msgStatus: "expired",
        activeClaimTeacherId: null,
        teacherId: ME,
      }),
    ).toEqual({ ok: true, kind: "claim" });
  });

  it("returns 'session-refresh' when this teacher already holds the claim", () => {
    expect(
      decideReplyKind({
        msgDirection: "in",
        msgStatus: "pending",
        activeClaimTeacherId: ME,
        teacherId: ME,
      }),
    ).toEqual({ ok: true, kind: "session-refresh" });
  });

  it("returns 'followup' for already-answered messages", () => {
    expect(
      decideReplyKind({
        msgDirection: "in",
        msgStatus: "answered",
        activeClaimTeacherId: null,
        teacherId: ME,
      }),
    ).toEqual({ ok: true, kind: "followup" });
  });

  it("returns 'followup' for answered even when this teacher has an active claim", () => {
    expect(
      decideReplyKind({
        msgDirection: "in",
        msgStatus: "answered",
        activeClaimTeacherId: ME,
        teacherId: ME,
      }),
    ).toEqual({ ok: true, kind: "followup" });
  });

  it("rejects answered when another teacher holds the claim", () => {
    expect(
      decideReplyKind({
        msgDirection: "in",
        msgStatus: "answered",
        activeClaimTeacherId: OTHER,
        teacherId: ME,
      }),
    ).toEqual({ ok: false, reason: "taken-by-other" });
  });
});
