// What a file's first bytes say it is. Used before a private original is
// recorded: a declared content type is only a claim, and an HTML error page
// or a truncated download saved as "photo.jpg" must not count as preserved
// media. Pure and dependency-free (runs in Convex, Next and tests).

export type FileSignature =
  | "jpeg" | "png" | "webp" | "gif" | "heic" | "avif"
  | "mp4" | "quicktime" | "mp3" | "m4a" | "ogg" | "wav" | "webm"
  | "html" | "pdf" | "zip" | "unknown";

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);

// ISO base media (MP4, MOV, HEIC, AVIF, M4A): "ftyp" at byte 4, then the brand.
const ISO_BRANDS: Record<string, FileSignature> = {
  heic: "heic", heix: "heic", hevc: "heic", hevx: "heic", heim: "heic", heis: "heic", mif1: "heic", msf1: "heic",
  avif: "avif", avis: "avif",
  "qt  ": "quicktime",
  "M4A ": "m4a", "M4B ": "m4a", "M4P ": "m4a",
};

/** Identify a file from its first bytes (16 are enough; 64 recommended). */
export const sniffFileSignature = (bytes: Uint8Array): FileSignature => {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return "wav";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "gif";
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    return ISO_BRANDS[brand] ?? "mp4";
  }
  if (ascii(bytes, 0, 4) === "OggS") return "ogg";
  if (ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) return "mp3";
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "webm";
  if (ascii(bytes, 0, 5) === "%PDF-") return "pdf";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  const head = ascii(bytes, 0, Math.min(bytes.length, 64)).replace(/^﻿/, "").trimStart().toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<?xml") || head.startsWith("<head") || head.startsWith("<body")) return "html";
  return "unknown";
};

// Which signatures honestly back each declared private-original type.
const ACCEPTS: Record<string, FileSignature[]> = {
  "image/jpeg": ["jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/heic": ["heic"],
  "image/heif": ["heic", "avif"],
  "video/mp4": ["mp4", "quicktime", "m4a"],
  "video/quicktime": ["quicktime", "mp4"],
  "audio/mpeg": ["mp3"],
  "audio/mp4": ["m4a", "mp4"],
  "audio/x-m4a": ["m4a", "mp4"],
  "audio/ogg": ["ogg"],
  "audio/wav": ["wav"],
};

/** Null when the bytes match the declared type; otherwise a plain reason. */
export const signatureMismatch = (declaredType: string, signature: FileSignature): string | null => {
  const accepted = ACCEPTS[declaredType];
  if (!accepted) return `${declaredType || "This type"} is not kept as a private original.`;
  if (accepted.includes(signature)) return null;
  if (signature === "html") return `The file is a web page, not ${declaredType}: the download probably failed. Nothing was kept.`;
  if (signature === "unknown") return `The file does not start like ${declaredType} (truncated or a different format). Nothing was kept.`;
  return `The file is ${signature}, but it was declared as ${declaredType}. Upload it with its real type. Nothing was kept.`;
};
