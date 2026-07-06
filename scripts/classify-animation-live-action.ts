// Classify every gallery asset as `animation` or `live-action` with Claude
// vision and write the label back as a tag (assets:addAssetTags).
//
// Usage:
//   bun run scripts/classify-animation-live-action.ts [--limit N] [--dry-run]
//   bun run scripts/classify-animation-live-action.ts --apply results.jsonl
//
// Idempotent: assets already tagged animation/live-action are skipped, so the
// script can be re-run to finish after interruptions. Videos are classified
// via their thumbnail and skipped (reported) when none exists. AVIF sources
// are skipped — the vision API accepts jpeg/png/gif/webp only.
//
// --apply skips classification and writes labels from a JSONL file of
// {"assetId": "...", "label": "animation"|"live-action"|...} lines (other
// labels are ignored) — used when classification ran out-of-band.

import Anthropic from "@anthropic-ai/sdk";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const listForClassification = makeFunctionReference<"query">(
  "assets:listAssetsForStyleClassification",
);
const addAssetTags = makeFunctionReference<"mutation">("assets:addAssetTags");

// The gallery's canonical deployment. Deliberately NOT read from CONVEX_URL:
// the shell often inherits a different project's deployment (see CLAUDE.md).
const CONVEX_URL =
  process.env.GALLERY_CONVEX_URL?.trim() ||
  "https://perfect-buffalo-375.convex.cloud";
const OWNER_USER_ID = process.env.GALLERY_OWNER_USER_ID?.trim() || "278674008";

const MODEL = "claude-opus-4-8";
const CONCURRENCY = 6;
const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;
const LABEL_TAGS = new Set(["animation", "live-action"]);

type SupportedMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

type ClassifiableAsset = {
  assetId: string;
  kind: "image" | "video";
  contentType?: string;
  url?: string;
  thumbUrl?: string;
  tagNames: string[];
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIndex = args.indexOf("--limit");
const limit =
  limitIndex !== -1 ? Number.parseInt(args[limitIndex + 1] ?? "", 10) : NaN;

function sniffMediaType(bytes: Uint8Array): SupportedMediaType | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
    return "image/png";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  return null;
}

async function fetchImage(
  url: string,
): Promise<{ base64: string; mediaType: SupportedMediaType } | { skip: string }> {
  const response = await fetch(url);
  if (!response.ok) return { skip: `fetch ${response.status}` };
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    return { skip: `too large (${Math.round(buffer.byteLength / 1024)}KB)` };
  }
  const mediaType = sniffMediaType(buffer);
  if (!mediaType) return { skip: "unsupported format (likely avif/video)" };
  return { base64: Buffer.from(buffer).toString("base64"), mediaType };
}

const CLASSIFY_INSTRUCTION = `Classify this image's visual style. Reply with exactly one word:
- animation — illustrated, anime, cartoon, 3D-rendered, painted, vector, or otherwise stylized non-photographic imagery
- live-action — photographic or photorealistic imagery that looks like it was captured with a camera (including photoreal AI generations and film stills)
- other — UI screenshots, documents, text-only graphics, charts, or anything that fits neither`;

async function classify(
  anthropic: Anthropic,
  base64: string,
  mediaType: SupportedMediaType,
): Promise<"animation" | "live-action" | "other"> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16,
    output_config: { effort: "low" },
    system:
      "You classify AI-generated gallery media by visual style. Respond with a single word only.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          { type: "text", text: CLASSIFY_INSTRUCTION },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") return "other";
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join(" ")
    .toLowerCase();
  if (text.includes("live-action") || text.includes("live action")) {
    return "live-action";
  }
  if (text.includes("animation")) return "animation";
  return "other";
}

async function applyLabelsFromFile(convex: ConvexHttpClient, file: string) {
  const lines = (await Bun.file(file).text())
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const labelByAsset = new Map<string, string>();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { assetId?: string; label?: string };
      const label = parsed.label?.toLowerCase().trim() ?? "";
      if (parsed.assetId && LABEL_TAGS.has(label)) {
        labelByAsset.set(parsed.assetId, label);
      }
    } catch {
      console.warn(`Skipping malformed line: ${line.slice(0, 80)}`);
    }
  }
  console.log(
    `Applying ${labelByAsset.size} labels from ${file} (of ${lines.length} lines).`,
  );

  const entries = [...labelByAsset.entries()];
  const counts = { animation: 0, "live-action": 0 };
  const failed: Array<{ assetId: string; error: string }> = [];
  let cursor = 0;
  const runners = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor];
      cursor += 1;
      if (!entry) continue;
      const [assetId, label] = entry;
      try {
        await convex.mutation(addAssetTags, {
          ownerUserId: OWNER_USER_ID,
          assetId,
          tagNames: [label],
        });
        counts[label as keyof typeof counts] += 1;
      } catch (error) {
        failed.push({
          assetId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
  await Promise.all(runners);

  console.log(
    `Applied: ${counts.animation} animation, ${counts["live-action"]} live-action.`,
  );
  if (failed.length > 0) {
    console.log(`Failed ${failed.length}:`);
    for (const entry of failed.slice(0, 20)) {
      console.log(`  ${entry.assetId}: ${entry.error}`);
    }
    process.exitCode = 1;
  }
}

const main = async () => {
  const convex = new ConvexHttpClient(CONVEX_URL);

  const applyIndex = args.indexOf("--apply");
  if (applyIndex !== -1) {
    const file = args[applyIndex + 1];
    if (!file) throw new Error("--apply requires a JSONL file path.");
    console.log(`Deployment: ${CONVEX_URL}`);
    await applyLabelsFromFile(convex, file);
    return;
  }

  const anthropic = new Anthropic();

  console.log(`Deployment: ${CONVEX_URL}`);
  console.log(`Mode: ${dryRun ? "DRY RUN (no tags written)" : "live"}`);

  const assets = (await convex.query(listForClassification, {
    ownerUserId: OWNER_USER_ID,
  })) as ClassifiableAsset[];

  const pending = assets.filter(
    (asset) => !asset.tagNames.some((name) => LABEL_TAGS.has(name.toLowerCase())),
  );
  const alreadyTagged = assets.length - pending.length;
  const queue = Number.isFinite(limit) ? pending.slice(0, limit) : pending;

  console.log(
    `Assets: ${assets.length} total, ${alreadyTagged} already tagged, ${queue.length} to classify.`,
  );

  const counts = { animation: 0, "live-action": 0, other: 0 };
  const skipped: Array<{ assetId: string; reason: string }> = [];
  const failed: Array<{ assetId: string; error: string }> = [];
  let done = 0;

  const worker = async (asset: ClassifiableAsset) => {
    try {
      // Thumbnails are smaller and always browser-decodable; fall back to the
      // original. Videos require a thumbnail.
      const mediaUrl =
        asset.kind === "video" ? asset.thumbUrl : asset.thumbUrl || asset.url;
      if (!mediaUrl) {
        skipped.push({ assetId: asset.assetId, reason: "no image url (video without thumb)" });
        return;
      }
      const image = await fetchImage(mediaUrl);
      if ("skip" in image) {
        // Thumbnail unusable — try the original for images before giving up.
        if (asset.kind === "image" && asset.thumbUrl && asset.url && mediaUrl !== asset.url) {
          const fallback = await fetchImage(asset.url);
          if (!("skip" in fallback)) {
            return await finish(asset, fallback.base64, fallback.mediaType);
          }
        }
        skipped.push({ assetId: asset.assetId, reason: image.skip });
        return;
      }
      await finish(asset, image.base64, image.mediaType);
    } catch (error) {
      failed.push({
        assetId: asset.assetId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      done += 1;
      if (done % 25 === 0 || done === queue.length) {
        console.log(
          `  ${done}/${queue.length} — animation ${counts.animation}, live-action ${counts["live-action"]}, other ${counts.other}, skipped ${skipped.length}, failed ${failed.length}`,
        );
      }
    }
  };

  const finish = async (
    asset: ClassifiableAsset,
    base64: string,
    mediaType: SupportedMediaType,
  ) => {
    const label = await classify(anthropic, base64, mediaType);
    counts[label] += 1;
    if (label === "other" || dryRun) return;
    await convex.mutation(addAssetTags, {
      ownerUserId: OWNER_USER_ID,
      assetId: asset.assetId,
      tagNames: [label],
    });
  };

  let cursor = 0;
  const runners = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < queue.length) {
      const asset = queue[cursor];
      cursor += 1;
      if (asset) await worker(asset);
    }
  });
  await Promise.all(runners);

  console.log("\nDone.");
  console.log(
    `Tagged: ${counts.animation} animation, ${counts["live-action"]} live-action. Neither: ${counts.other}.`,
  );
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length}:`);
    for (const entry of skipped.slice(0, 20)) {
      console.log(`  ${entry.assetId}: ${entry.reason}`);
    }
    if (skipped.length > 20) console.log(`  …and ${skipped.length - 20} more`);
  }
  if (failed.length > 0) {
    console.log(`Failed ${failed.length}:`);
    for (const entry of failed.slice(0, 20)) {
      console.log(`  ${entry.assetId}: ${entry.error}`);
    }
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
