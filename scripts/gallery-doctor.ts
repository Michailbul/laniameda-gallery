#!/usr/bin/env bun

import { ConvexHttpClient } from "convex/browser";

import { api } from "../convex/_generated/api";

const CONVEX_URL =
  process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const OWNER_USER_ID =
  process.env.OWNER_USER_ID ?? process.env.KB_OWNER_USER_ID ?? "";
const LIMIT = Math.min(
  Math.max(Number(process.env.LIMIT ?? "200") || 200, 1),
  500,
);
const JSON_OUTPUT = process.argv.includes("--json");

if (!CONVEX_URL) {
  throw new Error("CONVEX_URL is required.");
}

if (!OWNER_USER_ID) {
  throw new Error("OWNER_USER_ID or KB_OWNER_USER_ID is required.");
}

const client = new ConvexHttpClient(CONVEX_URL);

function groupByKey<T>(items: T[], getKey: (item: T) => string | undefined | null) {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = getKey(item);
    if (!key) {
      continue;
    }
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return groups;
}

function toDuplicateSummary<T>(groups: Map<string, T[]>) {
  return Array.from(groups.entries())
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => ({ key, count: items.length }));
}

function formatIdList(ids: string[]) {
  return ids.length === 0 ? "none" : ids.join(", ");
}

async function main() {
  const queryChecks: Array<{
    name: string;
    ok: boolean;
    error?: string;
  }> = [];

  try {
    await client.query(api.assets.listAssets, {
      ownerUserId: OWNER_USER_ID,
      limit: 5,
    });
    queryChecks.push({ name: "assets.listAssets", ok: true });
  } catch (error) {
    queryChecks.push({
      name: "assets.listAssets",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const [assets, prompts, promptOnly, packs] = await Promise.all([
    client.query(api.assets.listAssets, {
      ownerUserId: OWNER_USER_ID,
      limit: LIMIT,
    }),
    client.query(api.prompts.listPrompts, {
      ownerUserId: OWNER_USER_ID,
      limit: LIMIT,
    }),
    client.query(api.prompts.listPromptOnlyGalleryPrompts, {
      ownerUserId: OWNER_USER_ID,
      limit: LIMIT,
    }),
    client.query(api.assetPacks.listAssetPacks, {
      ownerUserId: OWNER_USER_ID,
      limit: LIMIT,
    }),
  ]);

  const packDetails = (
    await Promise.all(
      packs.map((pack) =>
        client.query(api.assetPacks.getAssetPackWithAssets, { packId: pack._id }),
      ),
    )
  ).filter((pack): pack is NonNullable<typeof pack> => Boolean(pack));

  const orphanAssets = assets
    .filter(
      (asset) =>
        !asset.promptId && !asset.designInspirationId && !asset.assetPackId,
    )
    .map((asset) => ({
      id: asset._id,
      fileName: asset.fileName ?? null,
      pillar: asset.pillar ?? null,
      modelName: asset.modelName ?? null,
    }));

  const duplicateIngestKeys = toDuplicateSummary(
    groupByKey(assets, (asset) => asset.ingestKey),
  );
  const duplicateStorageIds = toDuplicateSummary(
    groupByKey(assets, (asset) =>
      asset.storageId ? String(asset.storageId) : undefined,
    ),
  );
  const duplicateSourceUrls = toDuplicateSummary(
    groupByKey(assets, (asset) => asset.sourceUrl),
  );

  const loosePromptGroups = Array.from(
    groupByKey(
      assets.filter((asset) => asset.promptId && !asset.assetPackId),
      (asset) => String(asset.promptId),
    ).entries(),
  )
    .filter(([, groupedAssets]) => groupedAssets.length > 1)
    .map(([promptId, groupedAssets]) => ({
      promptId,
      count: groupedAssets.length,
      assetIds: groupedAssets.map((asset) => asset._id),
    }));

  const packIssues = packDetails.flatMap(({ pack, items }) => {
    const issues: string[] = [];
    const slotIndexes = items.map((item) => item.asset.packSlotIndex ?? -1);
    const sortedSlots = [...slotIndexes].sort((a, b) => a - b);
    const hasSequentialSlots = sortedSlots.every((slot, index) => slot === index);
    const memberIds = new Set(items.map((item) => item.asset._id));

    if ((pack.itemCount ?? 0) !== items.length) {
      issues.push(
        `itemCount=${pack.itemCount ?? 0} actualCount=${items.length}`,
      );
    }
    if (!hasSequentialSlots) {
      issues.push(`nonSequentialSlots=${sortedSlots.join(",")}`);
    }
    if (pack.coverAssetId && !memberIds.has(pack.coverAssetId)) {
      issues.push(`coverMissingFromPack=${pack.coverAssetId}`);
    }

    if (issues.length === 0) {
      return [];
    }

    return [
      {
        packId: pack._id,
        title: pack.title,
        issues,
      },
    ];
  });

  const summary = {
    ownerUserId: OWNER_USER_ID,
    convexUrl: CONVEX_URL,
    totals: {
      assets: assets.length,
      prompts: prompts.length,
      promptOnly: promptOnly.length,
      packs: packs.length,
      packedAssets: assets.filter((asset) => Boolean(asset.assetPackId)).length,
      standaloneAssets: assets.filter((asset) => !asset.assetPackId).length,
    },
    queryChecks,
    orphanAssets,
    loosePromptGroups,
    duplicateIngestKeys,
    duplicateStorageIds,
    duplicateSourceUrls,
    packIssues,
  };

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`Gallery doctor for owner ${OWNER_USER_ID}`);
  console.log(`Convex: ${CONVEX_URL}`);
  console.log("");
  console.log("Totals");
  console.log(`- assets: ${summary.totals.assets}`);
  console.log(`- prompts: ${summary.totals.prompts}`);
  console.log(`- prompt-only prompts: ${summary.totals.promptOnly}`);
  console.log(`- packs: ${summary.totals.packs}`);
  console.log(`- packed assets: ${summary.totals.packedAssets}`);
  console.log(`- standalone assets: ${summary.totals.standaloneAssets}`);
  console.log("");
  console.log("Query checks");
  for (const check of queryChecks) {
    console.log(
      check.ok
        ? `- OK ${check.name}`
        : `- FAIL ${check.name}: ${check.error}`,
    );
  }
  console.log("");
  console.log(`Orphan assets (${orphanAssets.length})`);
  for (const asset of orphanAssets) {
    console.log(
      `- ${asset.id} ${asset.fileName ?? "(no filename)"} pillar=${asset.pillar ?? "unknown"} model=${asset.modelName ?? "unknown"}`,
    );
  }
  if (orphanAssets.length === 0) {
    console.log("- none");
  }
  console.log("");
  console.log(`Loose multi-asset prompt groups (${loosePromptGroups.length})`);
  for (const group of loosePromptGroups) {
    console.log(
      `- prompt=${group.promptId} count=${group.count} assets=${formatIdList(group.assetIds)}`,
    );
  }
  if (loosePromptGroups.length === 0) {
    console.log("- none");
  }
  console.log("");
  console.log(`Duplicate ingest keys (${duplicateIngestKeys.length})`);
  for (const duplicate of duplicateIngestKeys) {
    console.log(`- ${duplicate.key} count=${duplicate.count}`);
  }
  if (duplicateIngestKeys.length === 0) {
    console.log("- none");
  }
  console.log("");
  console.log(`Duplicate storage ids (${duplicateStorageIds.length})`);
  for (const duplicate of duplicateStorageIds) {
    console.log(`- ${duplicate.key} count=${duplicate.count}`);
  }
  if (duplicateStorageIds.length === 0) {
    console.log("- none");
  }
  console.log("");
  console.log(`Duplicate source urls (${duplicateSourceUrls.length})`);
  for (const duplicate of duplicateSourceUrls) {
    console.log(`- ${duplicate.key} count=${duplicate.count}`);
  }
  if (duplicateSourceUrls.length === 0) {
    console.log("- none");
  }
  console.log("");
  console.log(`Pack issues (${packIssues.length})`);
  for (const issue of packIssues) {
    console.log(`- ${issue.packId} ${issue.title}: ${issue.issues.join("; ")}`);
  }
  if (packIssues.length === 0) {
    console.log("- none");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
