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
import type * as designInspirations from "../designInspirations.js";
import type * as files from "../files.js";
import type * as folderHelpers from "../folderHelpers.js";
import type * as folders from "../folders.js";
import type * as galleryAssetResults from "../galleryAssetResults.js";
import type * as helpers from "../helpers.js";
import type * as ingest from "../ingest.js";
import type * as ingest_failures from "../ingest_failures.js";
import type * as notifications from "../notifications.js";
import type * as prompts from "../prompts.js";
import type * as runs from "../runs.js";
import type * as semanticIndex from "../semanticIndex.js";
import type * as semanticSearch from "../semanticSearch.js";
import type * as tags from "../tags.js";
import type * as thumbnails from "../thumbnails.js";
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
  designInspirations: typeof designInspirations;
  files: typeof files;
  folderHelpers: typeof folderHelpers;
  folders: typeof folders;
  galleryAssetResults: typeof galleryAssetResults;
  helpers: typeof helpers;
  ingest: typeof ingest;
  ingest_failures: typeof ingest_failures;
  notifications: typeof notifications;
  prompts: typeof prompts;
  runs: typeof runs;
  semanticIndex: typeof semanticIndex;
  semanticSearch: typeof semanticSearch;
  tags: typeof tags;
  thumbnails: typeof thumbnails;
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

export declare const components: {};
