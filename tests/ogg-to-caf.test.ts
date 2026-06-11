import { describe, it, expect } from "vitest";
import {
  oggOpusToCaf,
  parseOggOpus,
  samplesPerPacket,
  encodeVarint,
  OggCafError,
} from "@/server/ogg-to-caf";

/* ------------------------------------------------------------------ *
 * Synthetic Ogg-Opus builder — structure only, no real audio. The
 * remuxer never decodes packets, it only moves bytes, so handmade
 * packets with valid TOC bytes are a faithful test medium.
 * ------------------------------------------------------------------ */

function oggPage(opts: {
  headerType: number;
  granule: bigint;
  seq: number;
  lacing: number[];
  payload: Uint8Array;
}): Uint8Array {
  const head = new Uint8Array(27 + opts.lacing.length);
  const dv = new DataView(head.buffer);
  head.set([0x4f, 0x67, 0x67, 0x53], 0); // OggS
  head[4] = 0; // version
  head[5] = opts.headerType;
  dv.setBigUint64(6, opts.granule, true);
  dv.setUint32(14, 1, true); // serial
  dv.setUint32(18, opts.seq, true);
  dv.setUint32(22, 0, true); // crc (unchecked by parser)
  head[26] = opts.lacing.length;
  head.set(opts.lacing, 27);
  const out = new Uint8Array(head.length + opts.payload.length);
  out.set(head, 0);
  out.set(opts.payload, head.length);
  return out;
}

function opusHead(channels: number, preSkip: number): Uint8Array {
  const b = new Uint8Array(19);
  b.set([...("OpusHead" as const)].map((c) => c.charCodeAt(0)), 0);
  b[8] = 1; // version
  b[9] = channels;
  b[10] = preSkip & 0xff;
  b[11] = preSkip >> 8;
  // input sample rate / gain / mapping left zero
  return b;
}

function opusTags(): Uint8Array {
  const b = new Uint8Array(16);
  b.set([...("OpusTags" as const)].map((c) => c.charCodeAt(0)), 0);
  return b;
}

/** Audio packet: TOC config 9 (SILK WB 20ms => 960 samples), code 0, mono. */
function audioPacket(len: number, fill = 0xab): Uint8Array {
  const p = new Uint8Array(len);
  p.fill(fill);
  p[0] = 9 << 3; // toc: config 9, mono, code 0 → one 20ms frame
  return p;
}

function buildOgg(packets: Uint8Array[], lastGranule: bigint): Uint8Array {
  // Page 0: OpusHead (BOS). Page 1: OpusTags. Page 2: all audio packets.
  const head = oggPage({
    headerType: 0x02,
    granule: 0n,
    seq: 0,
    lacing: [packets[0]!.length],
    payload: packets[0]!,
  });
  const tags = oggPage({
    headerType: 0,
    granule: 0n,
    seq: 1,
    lacing: [packets[1]!.length],
    payload: packets[1]!,
  });
  const audio = packets.slice(2);
  const payload = new Uint8Array(audio.reduce((a, p) => a + p.length, 0));
  let off = 0;
  for (const p of audio) {
    payload.set(p, off);
    off += p.length;
  }
  const audioPage = oggPage({
    headerType: 0x04, // EOS
    granule: lastGranule,
    seq: 2,
    lacing: audio.map((p) => p.length),
    payload,
  });
  const out = new Uint8Array(head.length + tags.length + audioPage.length);
  out.set(head, 0);
  out.set(tags, head.length);
  out.set(audioPage, head.length + tags.length);
  return out;
}

const PRE_SKIP = 312;

function standardOgg(packetLens = [100, 120, 90]): Uint8Array {
  return buildOgg(
    [opusHead(1, PRE_SKIP), opusTags(), ...packetLens.map((l, i) => audioPacket(l, 0xa0 + i))],
    BigInt(packetLens.length * 960),
  );
}

/* ------------------------------------------------------------------ */

describe("samplesPerPacket", () => {
  it("reads 20ms SILK WB mono (config 9, code 0) as 960", () => {
    expect(samplesPerPacket(audioPacket(50))).toBe(960);
  });
  it("doubles for code-1 packets", () => {
    const p = audioPacket(50);
    p[0] = (9 << 3) | 1;
    expect(samplesPerPacket(p)).toBe(1920);
  });
  it("reads code-3 frame count from byte 2", () => {
    const p = audioPacket(50);
    p[0] = (9 << 3) | 3;
    p[1] = 3; // 3 frames
    expect(samplesPerPacket(p)).toBe(2880);
  });
  it("handles CELT 2.5ms configs", () => {
    const p = audioPacket(50);
    p[0] = 16 << 3;
    expect(samplesPerPacket(p)).toBe(120);
  });
});

describe("encodeVarint", () => {
  it("single byte below 128", () => {
    expect([...encodeVarint(100)]).toEqual([100]);
  });
  it("two bytes with continuation bit", () => {
    // 200 = 0b11001000 → groups [1, 72] → [0x81, 0x48]
    expect([...encodeVarint(200)]).toEqual([0x81, 0x48]);
  });
  it("zero", () => {
    expect([...encodeVarint(0)]).toEqual([0]);
  });
});

describe("parseOggOpus", () => {
  it("extracts channels, preSkip, audio packets, granule", () => {
    const parsed = parseOggOpus(standardOgg());
    expect(parsed.channels).toBe(1);
    expect(parsed.preSkip).toBe(PRE_SKIP);
    expect(parsed.packets.length).toBe(3);
    expect(parsed.packets[0]!.length).toBe(100);
    expect(parsed.lastGranule).toBe(2880n);
  });

  it("reassembles a packet spanning two pages (255-lacing continuation)", () => {
    // One audio packet of 300 bytes: segment 255 on page A + segment 45 on page B.
    const big = audioPacket(300);
    const head = oggPage({ headerType: 0x02, granule: 0n, seq: 0, lacing: [19], payload: opusHead(1, PRE_SKIP) });
    const tags = oggPage({ headerType: 0, granule: 0n, seq: 1, lacing: [16], payload: opusTags() });
    const pageA = oggPage({ headerType: 0, granule: 0xffffffffffffffffn, seq: 2, lacing: [255], payload: big.subarray(0, 255) });
    const pageB = oggPage({ headerType: 0x05, granule: 960n, seq: 3, lacing: [45], payload: big.subarray(255) });
    const ogg = new Uint8Array([...head, ...tags, ...pageA, ...pageB]);
    const parsed = parseOggOpus(ogg);
    expect(parsed.packets.length).toBe(1);
    expect(parsed.packets[0]!.length).toBe(300);
    expect([...parsed.packets[0]!]).toEqual([...big]);
    expect(parsed.lastGranule).toBe(960n);
  });

  it("rejects non-ogg bytes", () => {
    expect(() => parseOggOpus(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(OggCafError);
  });

  it("rejects stereo+ channel counts above 2", () => {
    const ogg = buildOgg([opusHead(3, PRE_SKIP), opusTags(), audioPacket(50)], 960n);
    expect(() => parseOggOpus(ogg)).toThrow(/channel count/);
  });
});

describe("oggOpusToCaf", () => {
  function chunkAt(caf: Uint8Array, fourcc: string): { offset: number; size: number } {
    // Walk chunks: file header is 8 bytes.
    let pos = 8;
    const dv = new DataView(caf.buffer, caf.byteOffset, caf.byteLength);
    while (pos < caf.length) {
      const cc = String.fromCharCode(caf[pos]!, caf[pos + 1]!, caf[pos + 2]!, caf[pos + 3]!);
      const size = Number(dv.getBigInt64(pos + 4, false));
      if (cc === fourcc) return { offset: pos + 12, size };
      pos += 12 + size;
    }
    throw new Error(`chunk ${fourcc} not found`);
  }

  it("produces a structurally valid CAF", () => {
    const caf = oggOpusToCaf(standardOgg());
    const dv = new DataView(caf.buffer, caf.byteOffset, caf.byteLength);

    // File header: 'caff', version 1, flags 0.
    expect(String.fromCharCode(...caf.subarray(0, 4))).toBe("caff");
    expect(dv.getUint16(4, false)).toBe(1);
    expect(dv.getUint16(6, false)).toBe(0);

    // desc: 48kHz float64, 'opus', spp 960, mono.
    const desc = chunkAt(caf, "desc");
    expect(dv.getFloat64(desc.offset, false)).toBe(48000);
    expect(String.fromCharCode(...caf.subarray(desc.offset + 8, desc.offset + 12))).toBe("opus");
    expect(dv.getUint32(desc.offset + 20, false)).toBe(960); // frames/packet
    expect(dv.getUint32(desc.offset + 24, false)).toBe(1); // channels

    // pakt: 3 packets, validFrames = 3*960 - preSkip, priming = preSkip.
    const pakt = chunkAt(caf, "pakt");
    expect(Number(dv.getBigInt64(pakt.offset, false))).toBe(3);
    expect(Number(dv.getBigInt64(pakt.offset + 8, false))).toBe(3 * 960 - PRE_SKIP);
    expect(dv.getUint32(pakt.offset + 16, false)).toBe(PRE_SKIP);
    expect(dv.getUint32(pakt.offset + 20, false)).toBe(0);
    // Varints for 100, 120, 90 — all single-byte.
    expect([...caf.subarray(pakt.offset + 24, pakt.offset + 27)]).toEqual([100, 120, 90]);

    // pakt must come BEFORE data (optimized layout).
    const data = chunkAt(caf, "data");
    expect(pakt.offset).toBeLessThan(data.offset);

    // data: editCount 0 then packets concatenated verbatim.
    expect(dv.getUint32(data.offset, false)).toBe(0);
    expect(data.size).toBe(4 + 100 + 120 + 90);
    const firstPacket = caf.subarray(data.offset + 4, data.offset + 4 + 100);
    expect(firstPacket[0]).toBe(9 << 3);
    expect(firstPacket[1]).toBe(0xa0);
  });

  it("clamps valid frames via the final granule when shorter", () => {
    // Granule says 2000 samples total, packets say 2880 → valid = 2000 - preSkip.
    const ogg = buildOgg(
      [opusHead(1, PRE_SKIP), opusTags(), audioPacket(100), audioPacket(100), audioPacket(100)],
      2000n,
    );
    const caf = oggOpusToCaf(ogg);
    const dv = new DataView(caf.buffer, caf.byteOffset, caf.byteLength);
    // pakt follows desc(12+32) + chan(12+12) + file header(8) = offset 76; body at 88.
    const paktBody = 8 + 12 + 32 + 12 + 12 + 12;
    expect(Number(dv.getBigInt64(paktBody + 8, false))).toBe(2000 - PRE_SKIP);
    // remainder = packets*spp - granule-trimmed total = 2880 - 2000.
    expect(dv.getUint32(paktBody + 20, false)).toBe(880);
  });

  it("rejects mixed frames-per-packet streams", () => {
    const odd = audioPacket(80);
    odd[0] = (9 << 3) | 1; // 2 frames → 1920 samples
    const ogg = buildOgg([opusHead(1, PRE_SKIP), opusTags(), audioPacket(100), odd], 2880n);
    expect(() => oggOpusToCaf(ogg)).toThrow(/variable frames-per-packet/);
  });
});
