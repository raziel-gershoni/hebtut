import { describe, it, expect } from "vitest";
import { matchesPrompt } from "@/server/handlers/teacher-reply";

describe("matchesPrompt", () => {
  it("matches when reply_to_message_id and teacher_id both align", () => {
    expect(
      matchesPrompt(
        { replyToMessageId: 100, teacherId: 7 },
        { tg_prompt_message_id: 100, teacher_id: 7 },
      ),
    ).toBe(true);
  });
  it("rejects when message ids differ", () => {
    expect(
      matchesPrompt(
        { replyToMessageId: 100, teacherId: 7 },
        { tg_prompt_message_id: 999, teacher_id: 7 },
      ),
    ).toBe(false);
  });
  it("rejects when teacher mismatch", () => {
    expect(
      matchesPrompt(
        { replyToMessageId: 100, teacherId: 7 },
        { tg_prompt_message_id: 100, teacher_id: 999 },
      ),
    ).toBe(false);
  });
});
