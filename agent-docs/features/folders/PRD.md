# PRD: Owner-Scoped Folders (Backend)

Last updated: 2026-03-03
Status: Implemented (backend)
Owner: Product + Backend

## 1) Context

`laniameda.gallery` lets users save prompts and assets. Folder support exists in schema, but folder records are currently global and assignment has no ownership enforcement.

## 2) Problem Statement

Users need private, custom folders and the ability to move assets into folders safely. Current backend gaps:
1. Folder namespace is global.
2. Any `folderId` can be attached without owner checks.
3. No backend mutation for moving an existing asset between folders.
4. Folder delete lifecycle is incomplete (orphaned references risk).

## 3) Why Now

Folder organization is a core retrieval workflow for growing libraries. Without owner-scoped folders and assignment APIs, gallery organization is fragile and unsafe in multi-user contexts.

## 4) Goals

1. Make folders owner-scoped and idempotent by owner + normalized name.
2. Enforce folder ownership anywhere `folderId` is written.
3. Add a dedicated mutation for assigning an existing asset to a folder.
4. Support folder update/delete with safe reference cleanup.
5. Cover folder lifecycle in backend tests.

## 5) Non-Goals

1. No frontend folder creation UI in this phase.
2. No public/community folder browsing.
3. No bulk move UX.
4. No automatic legacy folder migration script in this phase.

## 6) Functional Requirements

1. `folders.createFolder` requires `ownerUserId` and is idempotent by normalized name per owner.
2. `folders.listFolders` returns only folders for `ownerUserId`.
3. `folders.updateFolder` renames/updates description with duplicate-name protection per owner.
4. `folders.deleteFolder` removes folder and clears `folderId` on owner’s assets/prompts.
5. `assets.setAssetFolder` moves an asset into/out of a folder.
6. `assets.createAsset`, `prompts.createPrompt`, `prompts.updatePrompt` must reject folder IDs not owned by caller.

## 7) Data Model Changes

`folders` table additions:
1. `ownerUserId?: string`
2. `normalizedName?: string`
3. `createdAt?: number`
4. `updatedAt?: number`

Indexes:
1. `by_owner_normalizedName`
2. `by_owner_createdAt`

## 8) API Surface (Convex)

1. `folders.createFolder(args: { ownerUserId, name, description? }) -> { folderId, created }`
2. `folders.listFolders(args: { ownerUserId }) -> Folder[]`
3. `folders.updateFolder(args: { ownerUserId, folderId, name, description? }) -> folderId`
4. `folders.deleteFolder(args: { ownerUserId, folderId }) -> { folderId, deleted, assetsUpdated, promptsUpdated }`
5. `assets.setAssetFolder(args: { ownerUserId, assetId, folderId? }) -> { assetId, folderId? }`

## 9) Security and Authorization

1. Folder writes require owner match.
2. Cross-user folder assignment throws `ConvexError`.
3. Folder deletion rejects non-owner access and cleans references only for owner-scoped records.

## 10) Test Plan

1. Unit/integration tests for folder lifecycle via Convex handlers with in-memory DB.
2. Validate:
   - owner-scoped dedupe
   - owner-filtered listing
   - cross-user assignment rejection
   - asset folder move
   - delete cleanup on prompts/assets
3. Quality gates: `bun run lint`, `bun test`.

## 11) Acceptance Criteria

1. A user can create/list/update/delete only their own folders.
2. A user can assign/unassign their assets to their folders.
3. Backend rejects foreign folder IDs in create/update flows.
4. Deleting a folder leaves no dangling `folderId` references for that owner.
5. Automated tests cover lifecycle and permission checks.

## 12) Risks and Mitigations

1. Risk: legacy global folders without owner fields become invisible.
   - Mitigation: keep schema additions optional; follow-up migration can claim/move legacy folders.
2. Risk: function signature changes break frontend calls.
   - Mitigation: update `listFolders` call sites in the dashboard with explicit `ownerUserId`.

## 13) Rollout

1. Merge backend changes behind existing auth gating.
2. Run Convex codegen/dev sync.
3. Ship with current UI using owner-scoped list endpoint.
4. Follow-up: folder create/manage UI and migration utility.
