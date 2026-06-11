import { describe, it, expect } from "vitest";
import { isButtonPrivacyError } from "@/lib/tg-errors";

describe("isButtonPrivacyError", () => {
  it("matches the grammY-shaped privacy-restricted error", () => {
    expect(
      isButtonPrivacyError(
        "Call to 'sendMessage' failed! (400: Bad Request: BUTTON_USER_PRIVACY_RESTRICTED)",
      ),
    ).toBe(true);
  });

  it("does not match an invalid-id error (distinct failure mode)", () => {
    expect(
      isButtonPrivacyError(
        "Call to 'sendMessage' failed! (400: Bad Request: PEER_ID_INVALID)",
      ),
    ).toBe(false);
  });

  it("does not match an unrelated error", () => {
    expect(isButtonPrivacyError("Call to 'sendMessage' failed! (403: Forbidden: bot was blocked by the user)")).toBe(false);
  });

  it("does not match an empty message", () => {
    expect(isButtonPrivacyError("")).toBe(false);
  });
});
