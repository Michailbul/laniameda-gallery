import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  formatsIncludeUndecodableAudio,
  inspectAudioCodecs,
  sampleEntryFormats,
  type ByteRangeReader,
} from "../lib/video-audio-check";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;

function readerFor(bytes: Uint8Array): { read: ByteRangeReader; size: number } {
  return {
    read: async (start, length) => bytes.subarray(start, start + length),
    size: bytes.byteLength,
  };
}

function ffmpeg(args: string[]) {
  const result = spawnSync("ffmpeg", ["-y", "-v", "error", ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr?.slice(0, 300)}`);
  }
}

describe("browser audio decodability check", () => {
  test.skipIf(!hasFfmpeg)(
    "a PCM .mov is caught even though moov sits at the tail",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "audiocheck-pcm-"));
      try {
        const out = join(dir, "pcm.mov");
        ffmpeg([
          "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=10",
          "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
          "-c:v", "libx264", "-pix_fmt", "yuv420p",
          "-c:a", "pcm_s24le", "-t", "2", out,
        ]);
        const bytes = readFileSync(out);

        // Precondition: this is the tail-moov layout the parser has to handle.
        expect(bytes.indexOf(Buffer.from("moov"))).toBeGreaterThan(bytes.length * 0.5);

        const { read, size } = readerFor(bytes);
        const check = await inspectAudioCodecs(read, size);
        expect(check.inspected).toBe(true);
        expect(check.hasUndecodableAudio).toBe(true);
        expect(check.formats).toContain("in24");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  test.skipIf(!hasFfmpeg)("an AAC remux of the same clip is cleared", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audiocheck-aac-"));
    try {
      const src = join(dir, "pcm.mov");
      const out = join(dir, "aac.mp4");
      ffmpeg([
        "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=10",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "pcm_s24le", "-t", "2", src,
      ]);
      ffmpeg(["-i", src, "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", out]);

      const { read, size } = readerFor(readFileSync(out));
      const check = await inspectAudioCodecs(read, size);
      expect(check.inspected).toBe(true);
      expect(check.hasUndecodableAudio).toBe(false);
      expect(check.formats).toContain("mp4a");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  // The regression that killed the simpler design: a whole-file fourcc scan
  // reports PCM here because "twos" occurs by chance in the video payload.
  test("a stray PCM fourcc in media payload does not trigger a false positive", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audiocheck-stray-"));
    try {
      if (!hasFfmpeg) return;
      const out = join(dir, "clean.mp4");
      ffmpeg([
        "-f", "lavfi", "-i", "testsrc=duration=1:size=160x120:rate=10",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-movflags", "+faststart", "-t", "1", out,
      ]);

      const clean = readFileSync(out);
      // Splice a PCM fourcc into the payload, well past the moov box.
      const poisoned = Buffer.from(clean);
      const stray = Buffer.from("twos");
      stray.copy(poisoned, poisoned.length - 512);
      expect(poisoned.includes(stray)).toBe(true);

      const { read, size } = readerFor(poisoned);
      const check = await inspectAudioCodecs(read, size);
      expect(check.hasUndecodableAudio).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test("an unparseable file reports not-inspected rather than claiming it is fine", async () => {
    const bytes = new Uint8Array(Buffer.from("this is not a container at all"));
    const { read, size } = readerFor(bytes);
    const check = await inspectAudioCodecs(read, size);
    expect(check.inspected).toBe(false);
    expect(check.hasUndecodableAudio).toBe(false);
  });

  test("format matching covers the PCM set and ignores video entries", () => {
    expect(formatsIncludeUndecodableAudio(["avc1", "in24"])).toBe(true);
    expect(formatsIncludeUndecodableAudio(["avc1", "sowt"])).toBe(true);
    expect(formatsIncludeUndecodableAudio(["hvc1", "mp4a"])).toBe(false);
    expect(formatsIncludeUndecodableAudio([])).toBe(false);
  });

  test("sampleEntryFormats tolerates a truncated moov", () => {
    expect(sampleEntryFormats(new Uint8Array([0x73, 0x74, 0x73, 0x64]))).toEqual([]);
  });
});
