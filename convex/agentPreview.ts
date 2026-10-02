"use node";

import { v, ConvexError, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import { ownerAction } from "./actor";
import type { previewAssetValidator } from "./agentPreviewData";
import {
  CONTACT_SHEET_BACKGROUND,
  CONTACT_SHEET_CELL_BACKGROUND,
  CONTACT_SHEET_JPEG_QUALITY,
  CONTACT_SHEET_MAX_CELLS,
  contactSheetCellOrigin,
  contactSheetCellOverlaySvg,
  layoutContactSheet,
  type ContactSheetLayout,
} from "../lib/contact-sheet";

// ── Agent contact sheet ─────────────────────────────────────────────────────
// Agents read the gallery as JSON: ids, captions, URLs. To choose references
// they need to SEE the pieces, and fetching 24 URLs one by one is slow and
// burns a vision read per image. This composes up to 48 owner-scoped pieces
// into one numbered JPEG grid (thumbs, never originals) plus a legend mapping
// each number to its asset id, so one image read covers a whole result page.

type Sharp = (typeof import("sharp"))["default"];

let sharpLoader: Promise<Sharp> | undefined;
const loadSharp = () => {
  sharpLoader ??= import("sharp").then((mod) => {
    mod.default.cache(false);
    return mod.default;
  });
  return sharpLoader;
};

const FETCH_TIMEOUT_MS = 15_000;
const FETCH_MAX_BYTES = 40 * 1024 * 1024;
const FETCH_CONCURRENCY = 6;
const LEGEND_DESCRIPTION_MAX = 220;
const LEGEND_TAG_MAX = 10;

const fetchPreviewBytes = async (url: string): Promise<Buffer> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > FETCH_MAX_BYTES) {
      throw new Error(`preview is ${declared} bytes, over the ${FETCH_MAX_BYTES} cap`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > FETCH_MAX_BYTES) {
      throw new Error(`preview is ${buffer.byteLength} bytes, over the ${FETCH_MAX_BYTES} cap`);
    }
    return buffer;
  } finally {
    clearTimeout(timer);
  }
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
) => {
  const results = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
};

export type ContactSheetCellInput = {
  /** Encoded image bytes, or null when there is nothing to draw. */
  bytes: Buffer | null;
  isVideo: boolean;
};

export type RenderedCellStatus = { ok: true } | { ok: false; error: string };

/** Compose the grid. Exported for tests; the action below is the only caller. */
export const renderContactSheet = async (
  sharp: Sharp,
  cells: ContactSheetCellInput[],
  layout: ContactSheetLayout,
) => {
  const size = layout.cellSize;
  const composites: Array<{ input: Buffer; left: number; top: number }> = [];
  const statuses: RenderedCellStatus[] = [];

  for (const [index, cell] of cells.entries()) {
    const { left, top } = contactSheetCellOrigin(layout, index);
    let failed = true;
    if (cell.bytes) {
      try {
        const tile = await sharp(cell.bytes, {
          failOn: "none",
          limitInputPixels: 268_402_689,
        })
          .autoOrient()
          .resize(size, size, { fit: "contain", background: CONTACT_SHEET_CELL_BACKGROUND })
          .flatten({ background: CONTACT_SHEET_CELL_BACKGROUND })
          .png({ compressionLevel: 1 })
          .toBuffer();
        composites.push({ input: tile, left, top });
        failed = false;
        statuses.push({ ok: true });
      } catch (error) {
        statuses.push({
          ok: false,
          error: `could not decode preview: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    } else {
      statuses.push({ ok: false, error: cell.isVideo ? "video has no poster frame" : "no preview" });
    }

    if (failed) {
      composites.push({
        input: await sharp({
          create: { width: size, height: size, channels: 3, background: CONTACT_SHEET_CELL_BACKGROUND },
        })
          .png()
          .toBuffer(),
        left,
        top,
      });
    }
    composites.push({
      input: Buffer.from(
        contactSheetCellOverlaySvg(size, { number: index + 1, isVideo: cell.isVideo, failed }),
      ),
      left,
      top,
    });
  }

  const image = await sharp({
    create: {
      width: layout.width,
      height: layout.height,
      channels: 3,
      background: CONTACT_SHEET_BACKGROUND,
    },
  })
    .composite(composites)
    .jpeg({ quality: CONTACT_SHEET_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  return { image, statuses };
};

const truncate = (value: string | undefined, max: number) => {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

const contactSheetCellValidator = v.object({
  number: v.number(),
  assetId: v.id("assets"),
  kind: v.union(v.literal("image"), v.literal("video")),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  agentDescription: v.optional(v.string()),
  tagNames: v.array(v.string()),
  folderIds: v.array(v.id("folders")),
  previewOk: v.boolean(),
  previewError: v.optional(v.string()),
});

const contactSheetResultValidator = v.object({
  contentType: v.literal("image/jpeg"),
  imageBase64: v.string(),
  width: v.number(),
  height: v.number(),
  columns: v.number(),
  rows: v.number(),
  cellSize: v.number(),
  cells: v.array(contactSheetCellValidator),
  missingIds: v.array(v.string()),
});

type PreviewAsset = Infer<typeof previewAssetValidator>;

export const contactSheet = ownerAction({
  args: {
    ownerUserId: v.optional(v.string()),
    assetIds: v.array(v.string()),
    columns: v.optional(v.number()),
    maxEdge: v.optional(v.number()),
  },
  returns: contactSheetResultValidator,
  handler: async (ctx, args): Promise<Infer<typeof contactSheetResultValidator>> => {
    const ownerUserId = args.ownerUserId?.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const assetIds = [
      ...new Set(
        args.assetIds
          .map((id) => id.trim().replace(/^assets?:/, ""))
          .filter((id) => id.length > 0),
      ),
    ];
    if (assetIds.length === 0) {
      throw new ConvexError("assetIds must name at least one asset.");
    }
    if (assetIds.length > CONTACT_SHEET_MAX_CELLS) {
      throw new ConvexError(
        `A contact sheet holds at most ${CONTACT_SHEET_MAX_CELLS} assets; got ${assetIds.length}. Split them across sheets.`,
      );
    }

    const { assets, missingIds }: { assets: PreviewAsset[]; missingIds: string[] } =
      await ctx.runQuery(internal.agentPreviewData.getPreviewAssets, { ownerUserId, assetIds });
    if (assets.length === 0) {
      throw new ConvexError("None of these assets exist in your gallery.");
    }

    const layout = layoutContactSheet(assets.length, {
      columns: args.columns,
      maxEdge: args.maxEdge,
    });
    const fetched = await mapWithConcurrency(assets, FETCH_CONCURRENCY, async (asset) => {
      if (!asset.previewUrl) return { bytes: null, error: undefined };
      try {
        return { bytes: await fetchPreviewBytes(asset.previewUrl), error: undefined };
      } catch (error) {
        return {
          bytes: null,
          error: `could not fetch preview: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    });

    const sharp = await loadSharp();
    const { image, statuses } = await renderContactSheet(
      sharp,
      assets.map((asset, index) => ({
        bytes: fetched[index].bytes,
        isVideo: asset.kind === "video",
      })),
      layout,
    );

    return {
      contentType: "image/jpeg" as const,
      imageBase64: image.toString("base64"),
      width: layout.width,
      height: layout.height,
      columns: layout.columns,
      rows: layout.rows,
      cellSize: layout.cellSize,
      cells: assets.map((asset, index) => {
        const status = statuses[index];
        const previewError = fetched[index].error ?? (status.ok ? undefined : status.error);
        return {
          number: index + 1,
          assetId: asset.assetId,
          kind: asset.kind,
          width: asset.width,
          height: asset.height,
          agentDescription: truncate(asset.agentDescription, LEGEND_DESCRIPTION_MAX),
          tagNames: asset.tagNames.slice(0, LEGEND_TAG_MAX),
          folderIds: asset.folderIds,
          previewOk: status.ok,
          ...(previewError ? { previewError } : {}),
        };
      }),
      missingIds,
    };
  },
});
