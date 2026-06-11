import { describe, it, expect } from "vitest";
import { deriveTitleFromFilename, MAX_TITLE_LEN } from "@/lib/media";

describe("deriveTitleFromFilename", () => {
  it("strips a trailing extension", () => {
    expect(deriveTitleFromFilename("lesson.mp4")).toBe("lesson");
  });

  it("keeps a name that has no extension", () => {
    expect(deriveTitleFromFilename("lesson")).toBe("lesson");
  });

  it("keeps a dotfile name untouched (leading dot is not an extension)", () => {
    expect(deriveTitleFromFilename(".bashrc")).toBe(".bashrc");
  });

  it("only strips the LAST extension", () => {
    expect(deriveTitleFromFilename("clip.final.mov")).toBe("clip.final");
  });

  it("clamps a long filename to the server title cap", () => {
    // The bug: a SaveClip-style filename far over the cap was pre-filled
    // into the title input, sailed past the input's maxLength (which only
    // limits typing), and the server rejected the POST as 'bad body'.
    const long = "SaveClip.App_" + "A".repeat(200) + ".mp4";
    const out = deriveTitleFromFilename(long);
    expect(out.length).toBe(MAX_TITLE_LEN);
    expect(out.startsWith("SaveClip.App_")).toBe(true);
  });

  it("returns at most MAX_TITLE_LEN chars even with no extension", () => {
    expect(deriveTitleFromFilename("x".repeat(500)).length).toBe(MAX_TITLE_LEN);
  });
});
