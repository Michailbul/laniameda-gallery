import { describe, expect, test } from "bun:test";

import {
  readVideoDimensions,
  type PixelDimensions,
} from "../convex/imageDimensions";

// --- Minimal ISO-BMFF (MP4/MOV) fixture builders ----------------------------

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
};

const u16 = (n: number) => {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n & 0xffff);
  return b;
};

const concat = (...parts: Uint8Array[]) => {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** `[u32 size]["type"][body]`. */
const box = (type: string, body: Uint8Array) =>
  concat(u32(body.length + 8), enc(type), body);

const IDENTITY_MATRIX = [
  0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000,
];
// 90° rotation: a=0, b=1, c=-1, d=0.
const ROTATE_90_MATRIX = [
  0, 0x00010000, 0, 0xffff0000, 0, 0, 0, 0, 0x40000000,
];

function tkhd(
  width: number,
  height: number,
  matrix: number[] = IDENTITY_MATRIX,
) {
  const versionFlags = Uint8Array.from([0, 0, 0, 0x07]); // v0, track enabled
  const times = new Uint8Array(20); // creation/mod/trackID/reserved/duration
  new DataView(times.buffer).setUint32(8, 1); // track_ID = 1
  const mid = new Uint8Array(16); // reserved[2] + layer/alt-group + volume/res
  const mtx = concat(...matrix.map(u32));
  const wh = concat(u32(width * 65536), u32(height * 65536)); // 16.16 fixed
  return box("tkhd", concat(versionFlags, times, mid, mtx, wh));
}

/** A `stsd` chain carrying one visual sample entry with coded w/h. */
function codedTrackBody(codedWidth: number, codedHeight: number) {
  const sampleEntry = concat(
    new Uint8Array(8), // 6 reserved + 2 data_reference_index
    new Uint8Array(16), // predefined(2)+reserved(2)+predefined*3(12)
    u16(codedWidth),
    u16(codedHeight),
    new Uint8Array(50), // remainder of VisualSampleEntry (unused here)
  );
  const avc1 = box("avc1", sampleEntry);
  const stsdBody = concat(u32(0) /* version+flags */, u32(1) /* entry_count */, avc1);
  const stsd = box("stsd", stsdBody);
  const stbl = box("stbl", stsd);
  const minf = box("minf", stbl);
  return box("mdia", minf);
}

const ftyp = box(
  "ftyp",
  concat(enc("isom"), u32(0x200), enc("isomiso2avc1mp41")),
);

/** Build a single-video-track MP4 from a tkhd. */
function mp4(...trakBodies: Uint8Array[]) {
  const traks = trakBodies.map((body) => box("trak", body));
  return concat(ftyp, box("moov", concat(...traks)));
}

// --- Tests ------------------------------------------------------------------

describe("readVideoDimensions", () => {
  test("reads landscape display dimensions from tkhd", () => {
    const bytes = mp4(tkhd(1920, 1080));
    expect(readVideoDimensions(bytes)).toEqual({ width: 1920, height: 1080 });
  });

  test("reads portrait display dimensions from tkhd (the Seedance 9:16 case)", () => {
    const bytes = mp4(tkhd(720, 1280));
    expect(readVideoDimensions(bytes)).toEqual({ width: 720, height: 1280 });
  });

  test("swaps width/height when the display matrix encodes a 90° rotation", () => {
    // Landscape-coded 1920x1080 frames, rotated to portrait for display.
    const bytes = mp4(tkhd(1920, 1080, ROTATE_90_MATRIX));
    expect(readVideoDimensions(bytes)).toEqual({ width: 1080, height: 1920 });
  });

  test("skips a zero-sized audio track and uses the video track", () => {
    const audio = tkhd(0, 0);
    const video = tkhd(1080, 1920);
    // Audio track first to prove ordering doesn't matter.
    const bytes = mp4(audio, video);
    expect(readVideoDimensions(bytes)).toEqual({ width: 1080, height: 1920 });
  });

  test("picks the largest-area track when several carry dimensions", () => {
    const bytes = mp4(tkhd(320, 240), tkhd(1280, 720));
    expect(readVideoDimensions(bytes)).toEqual({ width: 1280, height: 720 });
  });

  test("falls back to coded sample dimensions when tkhd size is zero", () => {
    const trak = concat(tkhd(0, 0), codedTrackBody(540, 960));
    const bytes = mp4(trak);
    expect(readVideoDimensions(bytes)).toEqual({ width: 540, height: 960 });
  });

  test("supports a 64-bit largesize moov box", () => {
    const moovBody = box("trak", tkhd(800, 600));
    // size=1 signals a 64-bit largesize after the fourCC.
    const largesizeMoov = concat(
      u32(1),
      enc("moov"),
      u32(0),
      u32(moovBody.length + 16),
      moovBody,
    );
    const bytes = concat(ftyp, largesizeMoov);
    expect(readVideoDimensions(bytes)).toEqual({ width: 800, height: 600 });
  });

  test("returns null for non-video / garbage bytes", () => {
    expect(readVideoDimensions(new Uint8Array([0, 1, 2, 3]))).toBeNull();
    expect(readVideoDimensions(enc("GIF89a not a video at all"))).toBeNull();
  });

  test("returns null rather than reading past a truncated box", () => {
    const bytes = mp4(tkhd(1920, 1080)).slice(0, 40);
    const result: PixelDimensions | null = readVideoDimensions(bytes);
    expect(result).toBeNull();
  });
});
