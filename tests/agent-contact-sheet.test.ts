import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

import {
  CONTACT_SHEET_DEFAULT_MAX_EDGE,
  autoContactSheetColumns,
  bitmapDigitsSvg,
  contactSheetCellOrigin,
  contactSheetCellOverlaySvg,
  layoutContactSheet,
} from "../lib/contact-sheet";
import { renderContactSheet } from "../convex/agentPreview";
import { handlePreview } from "../skills/laniameda-gallery/scripts/query";

describe("contact sheet layout", () => {
  test("auto columns keep the grid near 4:3", () => {
    expect(autoContactSheetColumns(1)).toBe(1);
    expect(autoContactSheetColumns(3)).toBe(2);
    expect(autoContactSheetColumns(4)).toBe(2);
    expect(autoContactSheetColumns(6)).toBe(3);
    expect(autoContactSheetColumns(24)).toBe(6);
    expect(autoContactSheetColumns(48)).toBe(8);
  });

  test("sheets never pass the max edge", () => {
    for (const count of [1, 2, 5, 12, 24, 37, 48]) {
      const layout = layoutContactSheet(count);
      expect(layout.width).toBeLessThanOrEqual(CONTACT_SHEET_DEFAULT_MAX_EDGE);
      expect(layout.height).toBeLessThanOrEqual(CONTACT_SHEET_DEFAULT_MAX_EDGE);
      expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(count);
    }
    const tall = layoutContactSheet(12, { columns: 1, maxEdge: 900 });
    expect(tall.height).toBeLessThanOrEqual(900);
    expect(tall.rows).toBe(12);
  });

  test("a 24-piece sheet keeps cells big enough to read", () => {
    const layout = layoutContactSheet(24);
    expect(layout.columns).toBe(6);
    expect(layout.rows).toBe(4);
    expect(layout.cellSize).toBeGreaterThanOrEqual(240);
  });

  test("columns are clamped to the count and the maximum", () => {
    expect(layoutContactSheet(3, { columns: 10 }).columns).toBe(3);
    expect(layoutContactSheet(40, { columns: 99 }).columns).toBe(12);
  });

  test("cells run left to right, top to bottom", () => {
    const layout = layoutContactSheet(6, { columns: 3 });
    const step = layout.cellSize + layout.gap;
    expect(contactSheetCellOrigin(layout, 0)).toEqual({ left: layout.gap, top: layout.gap });
    expect(contactSheetCellOrigin(layout, 2)).toEqual({
      left: layout.gap + 2 * step,
      top: layout.gap,
    });
    expect(contactSheetCellOrigin(layout, 3)).toEqual({ left: layout.gap, top: layout.gap + step });
  });
});

describe("contact sheet labels", () => {
  test("digits are drawn as rects, never font text", () => {
    const rects = bitmapDigitsSvg("1", 0, 0, 2);
    // "1": rows of 1,2,1,1,1,1,3 lit dots, each row one merged run.
    expect(rects.match(/<rect /g)?.length).toBe(7);
    const overlay = contactSheetCellOverlaySvg(256, { number: 48, isVideo: true, failed: true });
    expect(overlay).not.toContain("<text");
    expect(overlay).toContain("<polygon");
    expect(overlay).toContain("<line");
  });
});

const solid = (width: number, height: number, background: { r: number; g: number; b: number }) =>
  sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();

describe("renderContactSheet", () => {
  test("draws decodable pieces and marks the rest", async () => {
    const red = await solid(400, 200, { r: 230, g: 20, b: 20 });
    const blue = await solid(120, 300, { r: 20, g: 20, b: 230 });
    const layout = layoutContactSheet(4, { maxEdge: 600 });

    const { image, statuses } = await renderContactSheet(
      sharp,
      [
        { bytes: red, isVideo: false },
        { bytes: blue, isVideo: true },
        { bytes: null, isVideo: true },
        { bytes: Buffer.from("not an image"), isVideo: false },
      ],
      layout,
    );

    expect(statuses.map((status) => status.ok)).toEqual([true, true, false, false]);
    expect(statuses[2]).toEqual({ ok: false, error: "video has no poster frame" });

    const metadata = await sharp(image).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(layout.width);
    expect(metadata.height).toBe(layout.height);

    const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
    const pixelAt = (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels;
      return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
    };
    const center = (index: number) => {
      const origin = contactSheetCellOrigin(layout, index);
      return pixelAt(
        origin.left + Math.floor(layout.cellSize / 2),
        origin.top + Math.floor(layout.cellSize / 2),
      );
    };
    expect(center(0).r).toBeGreaterThan(180);
    expect(center(1).b).toBeGreaterThan(180);
    // The cell without pixels stays the neutral cell background.
    expect(center(2).r).toBeLessThan(120);
  });
});

describe("skill query preview", () => {
  test("searches, chunks into sheets and writes JPEGs with a numbered legend", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "contact-sheet-"));
    const jpeg = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();
    const calls: Array<{ path: string; args: Record<string, unknown> }> = [];
    try {
      const result = await handlePreview(
        { action: "preview", query: "neon alley", pieceType: "location", perSheet: 2, outDir },
        {
          convexUrl: "https://example.convex.cloud",
          ownerUserId: "telegram:278674008",
          fetchImpl: async (_url, init) => {
            const body = JSON.parse(String(init?.body)) as {
              path: string;
              args: Record<string, unknown>;
            };
            calls.push(body);
            const value =
              body.path === "semanticSearch:searchAssets"
                ? [
                    { _id: "a1", kind: "image", score: 0.9 },
                    { _id: "a2", kind: "video", score: 0.8 },
                    { _id: "a3", kind: "image", score: 0.7 },
                  ]
                : {
                    contentType: "image/jpeg",
                    imageBase64: jpeg.toString("base64"),
                    width: 8,
                    height: 8,
                    columns: 2,
                    rows: 1,
                    missingIds: [],
                    cells: (body.args.assetIds as string[]).map((assetId, index) => ({
                      number: index + 1,
                      assetId,
                      kind: assetId === "a2" ? "video" : "image",
                      tagNames: ["neon"],
                      previewOk: assetId !== "a2",
                      ...(assetId === "a2" ? { previewError: "video has no poster frame" } : {}),
                    })),
                  };
            return new Response(JSON.stringify({ status: "success", value }), { status: 200 });
          },
        },
      );

      expect(calls.map((call) => call.path)).toEqual([
        "semanticSearch:searchAssets",
        "agentPreview:contactSheet",
        "agentPreview:contactSheet",
      ]);
      expect(calls[0].args).toMatchObject({ query: "neon alley", pieceType: "location" });
      expect(calls[1].args).toMatchObject({
        ownerUserId: "telegram:278674008",
        assetIds: ["a1", "a2"],
      });
      expect(calls[2].args).toMatchObject({ assetIds: ["a3"] });

      expect(result.count).toBe(3);
      expect(result.sheets).toHaveLength(2);
      expect(result.sheets[0].path).toBe(join(outDir, "sheet-1.jpg"));
      expect(result.sheets[0].cells[0]).toMatchObject({ number: 1, id: "asset:a1", score: 0.9 });
      expect(result.sheets[0].cells[1]).toMatchObject({
        id: "asset:a2",
        previewError: "video has no poster frame",
      });
      expect(result.sheets[1].cells[0]).toMatchObject({ number: 1, id: "asset:a3" });
      expect(await readFile(result.sheets[1].path)).toEqual(jpeg);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  test("explicit ids skip the search and accept typed ids", async () => {
    const calls: Array<{ path: string; args: Record<string, unknown> }> = [];
    const outDir = await mkdtemp(join(tmpdir(), "contact-sheet-"));
    try {
      await handlePreview(
        { action: "preview", ids: ["asset:x1", "x2"], outDir },
        {
          convexUrl: "https://example.convex.cloud",
          ownerUserId: "telegram:278674008",
          fetchImpl: async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            calls.push(body);
            return new Response(
              JSON.stringify({
                status: "success",
                value: {
                  contentType: "image/jpeg",
                  imageBase64: "",
                  width: 1,
                  height: 1,
                  columns: 2,
                  rows: 1,
                  missingIds: ["x2"],
                  cells: [],
                },
              }),
              { status: 200 },
            );
          },
        },
      );
      expect(calls).toHaveLength(1);
      expect(calls[0].args.assetIds).toEqual(["x1", "x2"]);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
