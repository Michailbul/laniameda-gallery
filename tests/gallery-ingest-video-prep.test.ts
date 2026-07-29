import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertBase64Ingestible,
  buildCreateArgs,
  curateAsset,
  describeRemuxReason,
  posterTimestamp,
  probeVideo,
} from "../skills/laniameda-gallery-ingest/scripts/ingest";

const hasFfmpeg =
  spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { encoding: "utf8" }).status === 0;

// A .mov carrying pcm_s24le is exactly what DaVinci and QuickTime export, and
// it is the failure this pipeline exists to catch: the asset ingests clean and
// plays silent.
function makePcmMov(dir: string): string {
  const out = join(dir, "pcm-clip.mov");
  const result = spawnSync(
    "ffmpeg",
    [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=10",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-c:a", "pcm_s24le",
      "-t", "2",
      out,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !existsSync(out)) {
    throw new Error(`fixture build failed: ${result.stderr?.slice(0, 300)}`);
  }
  return out;
}

describe("gallery ingest video preparation", () => {
  // ffmpeg costs several seconds per invocation on macOS, so the fixture is
  // built once rather than per test.
  let fixtureDir = "";
  let pcmMovPath = "";

  beforeAll(() => {
    if (!hasFfmpeg) return;
    fixtureDir = mkdtempSync(join(tmpdir(), "ingest-fixture-"));
    pcmMovPath = makePcmMov(fixtureDir);
  }, 60_000);

  afterAll(() => {
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  });

  test.skipIf(!hasFfmpeg)("probeVideo reads dimensions and the audio codec", () => {
    const probe = probeVideo(pcmMovPath);
    expect(probe).toBeDefined();
    expect(probe!.width).toBe(320);
    expect(probe!.height).toBe(240);
    expect(probe!.hasAudio).toBe(true);
    expect(probe!.audioCodec).toBe("pcm_s24le");
    expect(probe!.durationSeconds).toBeGreaterThan(1);
  }, 30_000);

  test.skipIf(!hasFfmpeg)("PCM audio is flagged for remux, AAC is not", () => {
    const probe = probeVideo(pcmMovPath)!;
    expect(describeRemuxReason("clip.mov", probe)).toContain("pcm_s24le");

    // Audio wins over container: silent playback is the failure that matters.
    const safe = { ...probe, audioCodec: "aac" };
    expect(describeRemuxReason("clip.mp4", safe)).toBeUndefined();
    // ...but a .mov is still normalised even with a safe payload.
    expect(describeRemuxReason("clip.mov", safe)).toContain("container");
  }, 30_000);

  test("probeVideo returns undefined for a file ffprobe cannot read", () => {
    const dir = mkdtempSync(join(tmpdir(), "ingest-bad-"));
    try {
      const bogus = join(dir, "not-a-video.mp4");
      writeFileSync(bogus, "definitely not a container");
      expect(probeVideo(bogus)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  test("poster timestamp lands 15% in, clamped, and honours an override", () => {
    const base = { width: 1920, height: 1080, hasAudio: false, audioCodec: undefined };
    // 15% of 60s = 9s
    expect(posterTimestamp({ ...base, durationSeconds: 60 })).toBeCloseTo(9, 5);
    // clamped to at least 1s on a very short clip
    expect(posterTimestamp({ ...base, durationSeconds: 2 })).toBe(1);
    // clamped to at most 10s on a long one
    expect(posterTimestamp({ ...base, durationSeconds: 600 })).toBe(10);
    // unknown duration still yields a usable seek
    expect(posterTimestamp({ ...base, durationSeconds: 0 })).toBe(1);
    // explicit override wins, including 0
    expect(posterTimestamp({ ...base, durationSeconds: 60 }, 24)).toBe(24);
    expect(posterTimestamp({ ...base, durationSeconds: 60 }, 0)).toBe(0);
  });

  test("oversized base64 files fail with the remedy, not a Convex arg error", () => {
    const dir = mkdtempSync(join(tmpdir(), "ingest-size-"));
    try {
      const big = join(dir, "huge.png");
      writeFileSync(big, Buffer.alloc(11 * 1024 * 1024));
      expect(() => assertBase64Ingestible(big, "huge.png")).toThrow(/compress it to JPEG/);
      expect(() => assertBase64Ingestible(big, "huge.png", "do the other thing")).toThrow(
        /do the other thing/,
      );

      const small = join(dir, "small.png");
      writeFileSync(small, Buffer.alloc(1024));
      expect(() => assertBase64Ingestible(small, "small.png")).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The CLI cannot exercise this: bun auto-loads .env.local, so the secret is
  // always present when the script runs from the repo. In-process is the only
  // place the guard is reachable.
  test("publishing without the curation secret refuses, and says the asset survived", async () => {
    const saved = process.env.CURATION_ADMIN_SECRET;
    delete process.env.CURATION_ADMIN_SECRET;
    try {
      await expect(
        curateAsset("https://example.invalid", "asset-1", "owner-1", true, () => {}),
      ).rejects.toThrow(/CURATION_ADMIN_SECRET is required/);
      // The message has to say the asset still exists, or the caller re-ingests.
      await expect(
        curateAsset("https://example.invalid", "asset-1", "owner-1", true, () => {}),
      ).rejects.toThrow(/created and is private/);
    } finally {
      if (saved === undefined) delete process.env.CURATION_ADMIN_SECRET;
      else process.env.CURATION_ADMIN_SECRET = saved;
    }
  });

  test("prepared R2 media replaces the base64 file arg", () => {
    const args = buildCreateArgs(
      { filePath: "/tmp/does-not-need-to-exist.mp4", ingestKey: "k" },
      "owner-1",
      {
        r2Key: "r2-key-1",
        mediaContentType: "video/mp4",
        mediaSize: 61022423,
        mediaWidth: 2206,
        mediaHeight: 946,
        mediaFileName: "clip.mp4",
        posterFile: {
          base64: "AAAA",
          contentType: "image/jpeg",
          width: 1280,
          height: 548,
          size: 4,
        },
      },
    );

    expect(args.r2Key).toBe("r2-key-1");
    expect(args.mediaWidth).toBe(2206);
    expect(args.mediaHeight).toBe(946);
    expect(args.mediaFileName).toBe("clip.mp4");
    expect((args.posterFile as { height?: number }).height).toBe(548);
    // The R2 branch must not also send bytes — that is the whole point.
    expect(args.file).toBeUndefined();
  });
});
