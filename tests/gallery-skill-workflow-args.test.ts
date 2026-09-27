import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildWorkflowArgs,
  type PreparedWorkflowMedia,
} from "../skills/laniameda-gallery/scripts/ingest";

describe("workflow ingest args", () => {
  test("step media carries its caption and an R2-prepared video", () => {
    const prepared: PreparedWorkflowMedia = new Map([
      [
        "1:0",
        {
          r2Key: "videos/cut.mp4",
          mediaContentType: "video/mp4",
          mediaSize: 17_943_895,
          mediaWidth: 1920,
          mediaHeight: 1620,
          mediaFileName: "cut.mp4",
          posterFile: {
            base64: "AA==",
            contentType: "image/jpeg",
            width: 1280,
            height: 1080,
            size: 2,
          },
        },
      ],
    ]);

    const args = buildWorkflowArgs(
      {
        operation: "workflow",
        title: "1890s GRWM vlog",
        ingestKey: "gallery:test:workflow:v1",
        steps: [
          {
            stepLabel: "Identity portrait",
            promptText: "Render a portrait",
            media: [
              {
                url: "https://cdn.test/portrait.png",
                description: "Stand-in crop from the outfit sheet",
              },
            ],
          },
          {
            stepLabel: "Vlog",
            promptText: "A 30-second vlog",
            media: [
              {
                filePath: "/nowhere/cut.mp4",
                description: "Published 30s cut",
              },
            ],
          },
        ],
      },
      "278674008",
      prepared,
    );

    const steps = args.steps as Array<{ media: Array<Record<string, unknown>> }>;
    expect(steps[0]!.media[0]).toEqual({
      url: "https://cdn.test/portrait.png",
      description: "Stand-in crop from the outfit sheet",
    });

    const video = steps[1]!.media[0]!;
    expect(video.r2Key).toBe("videos/cut.mp4");
    expect(video.mediaWidth).toBe(1920);
    expect(video.mediaHeight).toBe(1620);
    expect(video.posterFile).toMatchObject({ contentType: "image/jpeg" });
    expect(video.description).toBe("Published 30s cut");
    // The bytes never ride the Convex argument.
    expect(video.file).toBeUndefined();
  });

  test("a video that skipped the R2 preparation is refused, not base64-encoded", () => {
    const dir = mkdtempSync(join(tmpdir(), "laniameda-workflow-args-"));
    const videoPath = join(dir, "cut.mp4");
    writeFileSync(videoPath, "fake mp4 bytes");
    try {
      expect(() =>
        buildWorkflowArgs(
          {
            operation: "workflow",
            title: "Video step",
            steps: [{ promptText: "A cut", media: [{ filePath: videoPath }] }],
          },
          "278674008",
        ),
      ).toThrow(/video/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
