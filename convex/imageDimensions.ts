/**
 * Dependency-free intrinsic-dimension reader for the image formats the gallery
 * actually stores. It parses headers only (no full decode), so it works for
 * WebP — which Jimp 1.x cannot decode — and for PNG/JPEG/GIF. Anything it can't
 * recognize returns null and the caller falls back to other dimension sources.
 */

export type PixelDimensions = { width: number; height: number };

const ascii = (bytes: Uint8Array, start: number, end: number) => {
  let out = "";
  for (let i = start; i < end; i += 1) out += String.fromCharCode(bytes[i]!);
  return out;
};

const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u32be = (b: Uint8Array, o: number) =>
  ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u16le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u24le = (b: Uint8Array, o: number) =>
  b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
const u32le = (b: Uint8Array, o: number) =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

const valid = (w: number, h: number): PixelDimensions | null =>
  Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
    ? { width: w, height: h }
    : null;

function readPng(b: Uint8Array): PixelDimensions | null {
  // 8-byte signature, then IHDR length+type, then width/height (BE) at 16/20.
  if (b.length < 24) return null;
  return valid(u32be(b, 16), u32be(b, 20));
}

function readGif(b: Uint8Array): PixelDimensions | null {
  if (b.length < 10) return null;
  return valid(u16le(b, 6), u16le(b, 8));
}

function readWebp(b: Uint8Array): PixelDimensions | null {
  // RIFF....WEBP<fourCC>
  if (b.length < 30) return null;
  const fourCC = ascii(b, 12, 16);
  if (fourCC === "VP8 ") {
    // Lossy: keyframe start code 0x9d 0x01 0x2a at 23..25, then 14-bit dims.
    if (!(b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)) return null;
    const w = u16le(b, 26) & 0x3fff;
    const h = u16le(b, 28) & 0x3fff;
    return valid(w, h);
  }
  if (fourCC === "VP8L") {
    // Lossless: 0x2f signature at 20, then packed 14-bit (width-1),(height-1).
    if (b[20] !== 0x2f) return null;
    const bits = u32le(b, 21);
    const w = (bits & 0x3fff) + 1;
    const h = ((bits >> 14) & 0x3fff) + 1;
    return valid(w, h);
  }
  if (fourCC === "VP8X") {
    // Extended: 24-bit (canvas width-1) at 24, (canvas height-1) at 27.
    const w = u24le(b, 24) + 1;
    const h = u24le(b, 27) + 1;
    return valid(w, h);
  }
  return null;
}

function readJpeg(b: Uint8Array): PixelDimensions | null {
  // Scan segments for a Start-Of-Frame marker carrying height/width.
  let offset = 2; // skip 0xFFD8
  const len = b.length;
  while (offset + 9 < len) {
    if (b[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = b[offset + 1]!;
    // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC) hold the frame dimensions.
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      const h = u16be(b, offset + 5);
      const w = u16be(b, offset + 7);
      return valid(w, h);
    }
    // Standalone markers (no length payload): RSTn, SOI, EOI, TEM.
    if (
      (marker >= 0xd0 && marker <= 0xd9) ||
      marker === 0x01 ||
      marker === 0xff
    ) {
      offset += 2;
      continue;
    }
    const segLen = u16be(b, offset + 2);
    if (segLen < 2) return null;
    offset += 2 + segLen;
  }
  return null;
}

function readIsoBmff(b: Uint8Array): PixelDimensions | null {
  // AVIF/HEIF (ISOBMFF) store the image size in an `ispe` box
  // (Image Spatial Extent): [u32 size]"ispe"[u8 version][u24 flags][u32 w][u32 h].
  // A file can carry several (thumbnails, alpha planes); pick the largest area.
  // Scanning for the fourCC and validating the box size avoids a full,
  // container-aware box walk while staying robust against false matches.
  let best: PixelDimensions | null = null;
  let bestArea = 0;
  for (let i = 4; i + 16 <= b.length; i += 1) {
    if (
      b[i] === 0x69 && // i
      b[i + 1] === 0x73 && // s
      b[i + 2] === 0x70 && // p
      b[i + 3] === 0x65 // e
    ) {
      const boxSize = u32be(b, i - 4);
      if (boxSize < 16 || boxSize > 64) continue;
      const w = u32be(b, i + 8);
      const h = u32be(b, i + 12);
      if (w > 0 && h > 0 && w <= 100000 && h <= 100000) {
        const area = w * h;
        if (area > bestArea) {
          bestArea = area;
          best = { width: w, height: h };
        }
      }
    }
  }
  return best;
}

/**
 * Best-effort intrinsic dimensions from raw image bytes. Returns null when the
 * format isn't recognized, so callers can fall back.
 */
export function readImageDimensions(
  bytes: Uint8Array,
): PixelDimensions | null {
  if (bytes.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return readPng(bytes);
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return readJpeg(bytes);
  }
  // GIF: "GIF8"
  if (ascii(bytes, 0, 4) === "GIF8") {
    return readGif(bytes);
  }
  // WebP: "RIFF"...."WEBP"
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return readWebp(bytes);
  }
  // ISOBMFF (AVIF/HEIF): box "ftyp" at offset 4.
  if (ascii(bytes, 4, 8) === "ftyp") {
    return readIsoBmff(bytes);
  }
  return null;
}
