/**
 * Lossless remux of an Ogg/Opus file (Telegram voice message) into Apple's
 * CAF container — NO transcoding, the raw Opus packets are copied verbatim.
 *
 * Why this exists: WebKit (the TG Mini App webview on iPhone/Mac) cannot
 * play Ogg/Opus via <audio> before iOS 18.4 / macOS Sequoia 15.4, but has
 * played Opus-in-CAF since iOS 11. ffmpeg cannot do this remux (its CAF
 * muxer rejects Opus outright as of 8.x), and no npm package exists — this
 * is a from-spec port cross-checked against the Go reference implementation
 * (nabil6391/opus_caf_converter) and Apple's CAF spec.
 *
 * Constraints (all satisfied by Telegram voice: libopus, 20ms frames, mono):
 *  - constant frames-per-packet across the stream (CAF `desc` requires it);
 *  - mono or stereo only.
 * Throws OggCafError on anything unexpected — callers fall back to serving
 * the original Ogg bytes.
 */

export class OggCafError extends Error {}

interface ParsedOgg {
  channels: number;
  preSkip: number;
  /** Raw Opus packets (OpusHead/OpusTags excluded). */
  packets: Uint8Array[];
  /** Granule position of the final page (total 48kHz samples incl. pre-skip). */
  lastGranule: bigint;
}

/** Samples per frame at 48 kHz for each Opus TOC config (RFC 6716 §3.1). */
function frameSamplesForConfig(config: number): number {
  // SILK NB/MB/WB (0-11): 10, 20, 40, 60 ms per row of four.
  if (config <= 11) return [480, 960, 1920, 2880][config % 4]!;
  // Hybrid SWB/FB (12-15): 10, 20 ms pairs.
  if (config <= 15) return [480, 960][config % 2]!;
  // CELT NB/WB/SWB/FB (16-31): 2.5, 5, 10, 20 ms per row of four.
  return [120, 240, 480, 960][config % 4]!;
}

/** Total 48kHz samples encoded by one Opus packet, from its TOC byte. */
export function samplesPerPacket(packet: Uint8Array): number {
  if (packet.length === 0) throw new OggCafError("empty opus packet");
  const toc = packet[0]!;
  const config = toc >> 3;
  const code = toc & 0x3;
  let frames: number;
  if (code === 0) frames = 1;
  else if (code === 1 || code === 2) frames = 2;
  else {
    if (packet.length < 2) throw new OggCafError("code-3 packet too short");
    frames = packet[1]! & 0x3f;
  }
  return frames * frameSamplesForConfig(config);
}

export function parseOggOpus(bytes: Uint8Array): ParsedOgg {
  const packets: Uint8Array[] = [];
  let pos = 0;
  let pending: Uint8Array[] = []; // segments of a packet continuing across pages
  let lastGranule = 0n;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  while (pos < bytes.length) {
    if (
      bytes[pos] !== 0x4f || // O
      bytes[pos + 1] !== 0x67 || // g
      bytes[pos + 2] !== 0x67 || // g
      bytes[pos + 3] !== 0x53 // S
    ) {
      throw new OggCafError(`bad ogg page magic at ${pos}`);
    }
    const headerType = bytes[pos + 5]!;
    const granule = view.getBigUint64(pos + 6, true);
    const nSegs = bytes[pos + 26]!;
    const lacing = bytes.subarray(pos + 27, pos + 27 + nSegs);
    let payloadPos = pos + 27 + nSegs;

    // A page whose first packet continues the previous page must carry the
    // continuation flag; if it doesn't, the pending data was truncated.
    if (pending.length > 0 && (headerType & 0x01) === 0) {
      throw new OggCafError("expected continuation page");
    }

    for (let i = 0; i < nSegs; i++) {
      const segLen = lacing[i]!;
      pending.push(bytes.subarray(payloadPos, payloadPos + segLen));
      payloadPos += segLen;
      if (segLen < 255) {
        // Packet complete.
        const total = pending.reduce((acc, s) => acc + s.length, 0);
        const packet = new Uint8Array(total);
        let off = 0;
        for (const s of pending) {
          packet.set(s, off);
          off += s.length;
        }
        packets.push(packet);
        pending = [];
      }
    }
    // granule -1 (unset) appears on pages that end no packet; skip those.
    if (granule !== 0xffffffffffffffffn) lastGranule = granule;
    pos = payloadPos;
  }
  if (pending.length > 0) throw new OggCafError("truncated final packet");
  if (packets.length < 3) throw new OggCafError("not an ogg-opus stream (need head, tags, audio)");

  const head = packets[0]!;
  const headMagic = String.fromCharCode(...head.subarray(0, 8));
  if (headMagic !== "OpusHead") throw new OggCafError("first packet is not OpusHead");
  const channels = head[9]!;
  if (channels !== 1 && channels !== 2) {
    throw new OggCafError(`unsupported channel count ${channels}`);
  }
  const preSkip = head[10]! | (head[11]! << 8);

  // packets[1] is OpusTags — verified loosely, then dropped.
  const tagsMagic = String.fromCharCode(...packets[1]!.subarray(0, 8));
  if (tagsMagic !== "OpusTags") throw new OggCafError("second packet is not OpusTags");

  return { channels, preSkip, packets: packets.slice(2), lastGranule };
}

/** Big-endian base-128 varint (CAF `pakt` packet-size encoding). */
export function encodeVarint(n: number): Uint8Array {
  if (n < 0) throw new OggCafError("negative varint");
  const groups: number[] = [];
  let v = n;
  do {
    groups.unshift(v & 0x7f);
    v = Math.floor(v / 128);
  } while (v > 0);
  for (let i = 0; i < groups.length - 1; i++) groups[i]! |= 0x80;
  return new Uint8Array(groups);
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  push(b: Uint8Array): void {
    this.chunks.push(b);
  }
  fourCC(s: string): void {
    this.push(new Uint8Array([...s].map((c) => c.charCodeAt(0))));
  }
  u16(n: number): void {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n, false);
    this.push(b);
  }
  u32(n: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, false);
    this.push(b);
  }
  i64(n: bigint): void {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, n, false);
    this.push(b);
  }
  f64(n: number): void {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, n, false);
    this.push(b);
  }
  concat(): Uint8Array<ArrayBuffer> {
    const total = this.chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}

/**
 * Remux Ogg/Opus bytes into a CAF file. Chunk order: desc, chan, pakt, data
 * — packet table BEFORE data ("optimized" layout) so <audio> learns the
 * duration before the payload arrives.
 */
export function oggOpusToCaf(ogg: Uint8Array): Uint8Array<ArrayBuffer> {
  const { channels, preSkip, packets, lastGranule } = parseOggOpus(ogg);
  if (packets.length === 0) throw new OggCafError("no audio packets");

  // CAF requires constant frames-per-packet; take the first packet's and
  // verify the rest (the final packet may legally be SHORTER via granule
  // trimming, but its TOC still declares the same frame layout).
  const spp = samplesPerPacket(packets[0]!);
  for (const p of packets) {
    if (samplesPerPacket(p) !== spp) {
      throw new OggCafError("variable frames-per-packet — cannot remux to CAF");
    }
  }

  const totalFromPackets = packets.length * spp;
  const totalFromGranule = lastGranule > 0n ? Number(lastGranule) : totalFromPackets;
  const totalSamples = Math.min(totalFromPackets, totalFromGranule);
  const validFrames = Math.max(0, totalSamples - preSkip);
  const dataBytes = packets.reduce((a, p) => a + p.length, 0);

  const w = new ByteWriter();
  // File header.
  w.fourCC("caff");
  w.u16(1); // version
  w.u16(0); // flags

  // 'desc' — Audio Description chunk (constant 32-byte body).
  w.fourCC("desc");
  w.i64(32n);
  w.f64(48000); // Opus always decodes at 48 kHz
  w.fourCC("opus");
  w.u32(0); // format flags
  w.u32(0); // bytes per packet (0 = variable)
  w.u32(spp); // frames per packet
  w.u32(channels);
  w.u32(0); // bits per channel (0 = compressed)

  // 'chan' — channel layout (mono / stereo tags).
  w.fourCC("chan");
  w.i64(12n);
  w.u32(channels === 1 ? (100 << 16) | 1 : (101 << 16) | 2);
  w.u32(0); // channel bitmap
  w.u32(0); // number of descriptions

  // 'pakt' — packet table.
  const varints = packets.map((p) => encodeVarint(p.length));
  const varintBytes = varints.reduce((a, v) => a + v.length, 0);
  w.fourCC("pakt");
  w.i64(BigInt(24 + varintBytes));
  w.i64(BigInt(packets.length));
  w.i64(BigInt(validFrames));
  w.u32(preSkip); // priming frames
  // Unused frames in the final packet (granule end-trim). The CAF identity:
  // packets*framesPerPacket == priming + valid + remainder.
  w.u32(totalFromPackets - totalSamples);
  for (const v of varints) w.push(v);

  // 'data' — edit count + raw packets.
  w.fourCC("data");
  w.i64(BigInt(4 + dataBytes));
  w.u32(0); // edit count
  for (const p of packets) w.push(p);

  return w.concat();
}
