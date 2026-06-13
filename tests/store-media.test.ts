import { describe, it, expect } from "vitest";
import { extFromTgFilePath, contentTypeForExt } from "@/server/store-media";

describe("extFromTgFilePath", () => {
  it("pulls the extension from a TG file_path", () => {
    expect(extFromTgFilePath("voice/file_12.oga")).toBe("oga");
    expect(extFromTgFilePath("video_notes/file_3.mp4")).toBe("mp4");
    expect(extFromTgFilePath("photos/file_9.JPG")).toBe("jpg");
  });
  it("falls back to bin when there is no extension", () => {
    expect(extFromTgFilePath("documents/file_1")).toBe("bin");
    expect(extFromTgFilePath("")).toBe("bin");
  });
});

describe("contentTypeForExt", () => {
  it("maps TG media extensions to playable content-types", () => {
    expect(contentTypeForExt("oga")).toBe("audio/ogg");
    expect(contentTypeForExt("ogg")).toBe("audio/ogg");
    expect(contentTypeForExt("opus")).toBe("audio/ogg");
    expect(contentTypeForExt("mp4")).toBe("video/mp4");
    expect(contentTypeForExt("mov")).toBe("video/quicktime");
    expect(contentTypeForExt("jpg")).toBe("image/jpeg");
    expect(contentTypeForExt("png")).toBe("image/png");
    expect(contentTypeForExt("webp")).toBe("image/webp");
  });
  it("defaults unknown extensions to octet-stream", () => {
    expect(contentTypeForExt("xyz")).toBe("application/octet-stream");
  });
});
