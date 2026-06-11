import { describe, it, expect } from "vitest";
import { prepareVoiceBytes } from "@/lib/voice-source";

/** Minimal synthetic Ogg-Opus (mirrors the builder in ogg-to-caf.test.ts). */
function syntheticOgg(): Uint8Array<ArrayBuffer> {
  function page(headerType: number, granule: bigint, seq: number, payload: Uint8Array): Uint8Array {
    const head = new Uint8Array(28);
    const dv = new DataView(head.buffer);
    head.set([0x4f, 0x67, 0x67, 0x53], 0);
    head[5] = headerType;
    dv.setBigUint64(6, granule, true);
    dv.setUint32(14, 1, true);
    dv.setUint32(18, seq, true);
    head[26] = 1;
    head[27] = payload.length;
    return new Uint8Array([...head, ...payload]);
  }
  const opusHead = new Uint8Array(19);
  opusHead.set([..."OpusHead"].map((c) => c.charCodeAt(0)), 0);
  opusHead[8] = 1;
  opusHead[9] = 1; // mono
  opusHead[10] = 56; // pre-skip 312 & 0xff
  opusHead[11] = 1; // 312 >> 8
  const opusTags = new Uint8Array(16);
  opusTags.set([..."OpusTags"].map((c) => c.charCodeAt(0)), 0);
  const audio = new Uint8Array(60);
  audio[0] = 9 << 3; // 20ms SILK WB mono, code 0
  return new Uint8Array([
    ...page(0x02, 0n, 0, opusHead),
    ...page(0, 0n, 1, opusTags),
    ...page(0x04, 960n, 2, audio),
  ]);
}

describe("prepareVoiceBytes", () => {
  it("passes ogg through untouched when the engine supports it", () => {
    const ogg = syntheticOgg();
    const out = prepareVoiceBytes(ogg, true);
    expect(out.type).toBe("audio/ogg");
    expect(out.bytes).toBe(ogg);
  });

  it("remuxes to CAF for engines without ogg support", () => {
    const out = prepareVoiceBytes(syntheticOgg(), false);
    expect(out.type).toBe("audio/x-caf");
    expect(String.fromCharCode(...out.bytes.subarray(0, 4))).toBe("caff");
  });

  it("falls back to raw ogg when the bytes are not a remuxable stream", () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = prepareVoiceBytes(garbage, false);
    expect(out.type).toBe("audio/ogg");
    expect(out.bytes).toBe(garbage);
  });
});
