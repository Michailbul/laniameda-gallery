#!/usr/bin/env bun
/**
 * One-time migration: consolidate pose-pack assets into an assetPack.
 * Run AFTER deploying the assetPacks schema to production Convex.
 * Usage: CONVEX_URL=https://<your-deployment>.convex.cloud OWNER_USER_ID=<your_telegram_id> \
 *   bun run scripts/migrate-pose-pack.ts
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const CONVEX_URL = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
if (!CONVEX_URL) throw new Error("CONVEX_URL is required");

const OWNER_USER_ID = (process.env.OWNER_USER_ID ?? "").trim();
if (!OWNER_USER_ID) {
  throw new Error("OWNER_USER_ID env var is required (Telegram numeric ID).");
}
const INGEST_KEY = "character-consistency-pose-pack-v1";

const client = new ConvexHttpClient(CONVEX_URL);

async function main() {
  console.log(`Connecting to: ${CONVEX_URL}`);

  // Check if pack already exists
  const existing = await client.query(api.assetPacks.getAssetPackByIngestKey, {
    ownerUserId: OWNER_USER_ID,
    ingestKey: INGEST_KEY,
  });

  if (existing) {
    console.log(`Pack already exists: ${existing._id}`);
    return;
  }

  // Fetch all assets
  const assets = await client.query(api.assets.listGalleryAssets, {
    ownerUserId: OWNER_USER_ID,
    kind: "image",
    limit: 200,
  });

  // Find pose-pack assets
  const poseAssets = assets.filter((a) => {
    const pt = a.promptText ?? "";
    return pt.includes("reference character") || (pt.includes("Eastern European woman") && pt.includes("lob"));
  });

  // Dedup by storageId
  const seen = new Set<string>();
  const deduped = poseAssets.filter((a) => {
    const key = a.storageId ?? a._id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => a.createdAt - b.createdAt);
  console.log(`Found ${deduped.length} unique pose-pack assets`);

  if (deduped.length === 0) {
    console.error("No pose-pack assets found. Check ownerUserId and promptText patterns.");
    process.exit(1);
  }

  // Create the pack
  const packId = await client.mutation(api.assetPacks.createAssetPack, {
    ownerUserId: OWNER_USER_ID,
    title: "Character Consistency Pose Pack v1",
    description: "27-pose character sheet for AI consistency testing. Eastern European woman, wavy dark brown lob, blue eyes. All angles: front, close-up, 45°, profile, full body.",
    pillar: "dump",
    ingestKey: INGEST_KEY,
    coverAssetId: deduped[0]._id as Id<"assets">,
    modelName: "Nano Banana Pro",
    domain: "character consistency",
    tagIds: [],
  });

  console.log(`Created pack: ${packId}`);

  // Link all assets
  for (let i = 0; i < deduped.length; i++) {
    const asset = deduped[i];
    await client.mutation(api.assetPacks.addAssetToPack, {
      packId: packId as Id<"assetPacks">,
      assetId: asset._id as Id<"assets">,
      packSlotIndex: i,
      setCover: i === 0,
    });
    console.log(`  [${String(i).padStart(2, "0")}] Linked ${asset._id}`);
  }

  console.log(`\n✅ Pack ${packId} created with ${deduped.length} assets`);
  console.log(`Gallery will now show 1 pack entry instead of ${deduped.length} individual assets`);
}

main().catch((err) => { console.error(err); process.exit(1); });
