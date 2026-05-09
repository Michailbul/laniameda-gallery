/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent_ingest from "../agent_ingest.js";
import type * as assetPackHelpers from "../assetPackHelpers.js";
import type * as assetPacks from "../assetPacks.js";
import type * as assets from "../assets.js";
import type * as authz from "../authz.js";
import type * as canvasPositions from "../canvasPositions.js";
import type * as designExtensionSaves from "../designExtensionSaves.js";
import type * as designInspirations from "../designInspirations.js";
import type * as designSaveHelpers from "../designSaveHelpers.js";
import type * as designSaveTemplates from "../designSaveTemplates.js";
import type * as files from "../files.js";
import type * as folderHelpers from "../folderHelpers.js";
import type * as folders from "../folders.js";
import type * as galleryAssetResults from "../galleryAssetResults.js";
import type * as generationLineage from "../generationLineage.js";
import type * as helpers from "../helpers.js";
import type * as ingest from "../ingest.js";
import type * as ingest_failures from "../ingest_failures.js";
import type * as notifications from "../notifications.js";
import type * as prompts from "../prompts.js";
import type * as r2 from "../r2.js";
import type * as r2_migrate from "../r2_migrate.js";
import type * as r2_migrate_db from "../r2_migrate_db.js";
import type * as r2_store from "../r2_store.js";
import type * as r2_url from "../r2_url.js";
import type * as runs from "../runs.js";
import type * as semanticIndex from "../semanticIndex.js";
import type * as semanticSearch from "../semanticSearch.js";
import type * as tags from "../tags.js";
import type * as thumbnails from "../thumbnails.js";
import type * as userPillars from "../userPillars.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent_ingest: typeof agent_ingest;
  assetPackHelpers: typeof assetPackHelpers;
  assetPacks: typeof assetPacks;
  assets: typeof assets;
  authz: typeof authz;
  canvasPositions: typeof canvasPositions;
  designExtensionSaves: typeof designExtensionSaves;
  designInspirations: typeof designInspirations;
  designSaveHelpers: typeof designSaveHelpers;
  designSaveTemplates: typeof designSaveTemplates;
  files: typeof files;
  folderHelpers: typeof folderHelpers;
  folders: typeof folders;
  galleryAssetResults: typeof galleryAssetResults;
  generationLineage: typeof generationLineage;
  helpers: typeof helpers;
  ingest: typeof ingest;
  ingest_failures: typeof ingest_failures;
  notifications: typeof notifications;
  prompts: typeof prompts;
  r2: typeof r2;
  r2_migrate: typeof r2_migrate;
  r2_migrate_db: typeof r2_migrate_db;
  r2_store: typeof r2_store;
  r2_url: typeof r2_url;
  runs: typeof runs;
  semanticIndex: typeof semanticIndex;
  semanticSearch: typeof semanticSearch;
  tags: typeof tags;
  thumbnails: typeof thumbnails;
  userPillars: typeof userPillars;
  users: typeof users;
  validators: typeof validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  r2: import("@convex-dev/r2/_generated/component.js").ComponentApi<"r2">;
};
