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
import type * as assets from "../assets.js";
import type * as files from "../files.js";
import type * as folders from "../folders.js";
import type * as helpers from "../helpers.js";
import type * as ingest from "../ingest.js";
import type * as prompts from "../prompts.js";
import type * as runs from "../runs.js";
import type * as tags from "../tags.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent_ingest: typeof agent_ingest;
  assets: typeof assets;
  files: typeof files;
  folders: typeof folders;
  helpers: typeof helpers;
  ingest: typeof ingest;
  prompts: typeof prompts;
  runs: typeof runs;
  tags: typeof tags;
  users: typeof users;
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
