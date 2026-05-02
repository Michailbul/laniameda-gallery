#!/usr/bin/env bun

import { ConvexHttpClient } from "convex/browser";

import { api } from "../convex/_generated/api";

const CONVEX_URL =
  process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const OWNER_USER_ID =
  process.env.OWNER_USER_ID ?? process.env.KB_OWNER_USER_ID ?? "";
const PAGE_SIZE = Math.min(
  Math.max(Number(process.env.PAGE_SIZE ?? "200") || 200, 1),
  500,
);

if (!CONVEX_URL) {
  throw new Error("CONVEX_URL is required.");
}

if (!OWNER_USER_ID) {
  throw new Error("OWNER_USER_ID or KB_OWNER_USER_ID is required.");
}

const client = new ConvexHttpClient(CONVEX_URL);

async function main() {
  console.log(`Connecting to ${CONVEX_URL}`);
  console.log(`Backfilling prompt packs for owner ${OWNER_USER_ID}`);
  console.log(`Page size: ${PAGE_SIZE}`);

  let createdBefore: number | undefined;
  let page = 0;
  let totalProcessedPromptCount = 0;
  let totalSyncedPromptCount = 0;
  let totalCreatedPackCount = 0;
  let totalRemovedPackCount = 0;
  let totalUpdatedAssetCount = 0;
  const packIds = new Set<string>();

  while (true) {
    page += 1;

    const result = await client.mutation(
      api.assetPacks.consolidateOwnerPromptPacks,
      {
        ownerUserId: OWNER_USER_ID,
        limit: PAGE_SIZE,
        createdBefore,
      },
    );

    totalProcessedPromptCount += result.processedPromptCount;
    totalSyncedPromptCount += result.syncedPromptCount;
    totalCreatedPackCount += result.createdPackCount;
    totalRemovedPackCount += result.removedPackCount;
    totalUpdatedAssetCount += result.updatedAssetCount;

    for (const packId of result.packIds) {
      packIds.add(packId);
    }

    console.log(
      [
        `page=${page}`,
        `processed=${result.processedPromptCount}`,
        `synced=${result.syncedPromptCount}`,
        `createdPacks=${result.createdPackCount}`,
        `removedPacks=${result.removedPackCount}`,
        `updatedAssets=${result.updatedAssetCount}`,
      ].join(" "),
    );

    if (!result.hasMore || result.nextCreatedBefore === undefined) {
      break;
    }

    if (createdBefore === result.nextCreatedBefore) {
      throw new Error(
        `Pagination stalled at createdBefore=${createdBefore}. Aborting to avoid an infinite loop.`,
      );
    }

    createdBefore = result.nextCreatedBefore;
  }

  console.log("");
  console.log("Pack backfill complete.");
  console.log(`Processed prompts: ${totalProcessedPromptCount}`);
  console.log(`Prompts needing sync: ${totalSyncedPromptCount}`);
  console.log(`Created packs: ${totalCreatedPackCount}`);
  console.log(`Removed stale packs: ${totalRemovedPackCount}`);
  console.log(`Updated asset rows: ${totalUpdatedAssetCount}`);
  console.log(`Touched pack ids: ${packIds.size}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
