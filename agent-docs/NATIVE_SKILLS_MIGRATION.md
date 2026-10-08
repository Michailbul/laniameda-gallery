# Native Skills migration

Skills have their own `skills` and `skillFolders` tables, canonical `skills:*`
functions, prompt `skillId`/`skillStepOrder`/`skillStepLabel` pointers, and
`skill_example` media role. This is a storage migration, not a display rename.
The deprecated Workflow API is replaced; user-written text and historical
generation metadata remain unchanged.

The old tables and fields are temporary source schemas. **Do not report the
migration finished until their rows, references, and schemas have been removed.**
The final schema removal is a separate reviewed publication after data verification,
so deployment never drops a table containing unverified content.

## Authorization and activation

Backend publication and data migration are separate actions. Use the canonical
authenticated cloud deployment; the dev name serves real gallery data. A Vercel
frontend build does not publish Convex. Keep deployment credentials outside the
repository; never print them. The existing sanitizer removes inherited deployment
keys, so an explicitly authorized noninteractive push may load the protected
credential file through the CLI's `--env-file` option:

```bash
bun scripts/convex-dev.ts --once --env-file /secure/path/convex.env
```

Do not use the package alias that appends `--local`. Migration mutations require
signed owner identity even when the legacy auth rollout switch is on. An operator
with the authorized deployment credential may act as the verified owner's identity
through the Convex CLI/SDK. Agents cannot supply another owner's ID to bypass this.

Pause related Skill/prompt/collection writers during the migration. Publish the
reviewed staging backend with a temporary old-frontend bridge first. Copy and
rewire every approved Skill before publishing the native frontend, then wait for
its successful deployment before retiring source records. Remove the private
bridge in the final backend publication. Capture full owner backups and the exact
approved source IDs before any retirement. A stale or changed graph stops the
operation.

## Copy, verify, rewire, retire

1. Read `skillMigration:listLegacySkills` under the signed owner. For each approved
   source call `migrateLegacySkill` with its ID, observed `expectedUpdatedAt`, and
   `phase: "copy"`. This creates a native Skill plus exact collection links and a
   private source snapshot/ID alias. It copies raw instructions, markdown, tags,
   ingest key, creation state, cover, flags, and timestamps. It does not re-ingest
   prompts or media. Oversize or foreign/missing references fail before partial copy.
2. Call `verifyLegacySkillMigration`. It compares the complete original graph and
   copied metadata/membership. For a proven broken cover only, supply a reviewed
   `coverRepairAssetId` at copy time; it must be an existing owned example of that
   Skill. The original broken pointer remains in its private source snapshot.
3. Call `phase: "rewire"`, then verify again. Every original prompt gets its native
   step pointer/order/label; original IDs/text/sections/models/tags remain unchanged.
   Step and body examples carrying the old hidden role become `skill_example`;
   ordinary media keep their roles. Search documents/failure pointers move to the
   native ID and reindexing is scheduled. Queued old reindex calls have a temporary
   alias bridge. Re-ingestion would be unsafe because deduplication can retain old
   prompt links; this operation links existing IDs directly.
4. Call `phase: "retire"`, then verify once more. Only the verified old container,
   old collection links and redundant packs within its exact prompt closure are
   removed. Pack metadata is archived with permanent redirects before clearing its
   membership fields. Original media, prompts, collections, stories, bookmarks,
   lineage, likes, source URLs, storage keys and privacy flags survive. Old prompt
   pointers are cleared. Each phase is transactional and retries return the same
   native ID. Unexpected mixed-pack membership stops retirement.

Repeat for the complete approved inventory, preserving per-ID phase/readback
receipts. Original typed body/example links use unchanged asset IDs. Full native
documents resolve body references without a 60-item truncation; card previews are
explicitly bounded and include covers, steps and body examples.

Ordinary reference/template batches require separate content review. They are not
automatically Skills, even if they have the old generation label. Orphan reference
media must receive a reviewed Gallery disposition; never delete or invent recipe
instructions just to make a count reach zero. Unhydrated media stubs still count
as database records and must be included in the raw closure audit.

## Mandatory final publication

Before contracting the schema, verify across the deployment that:

- `workflows` and `workflowFolders` have zero remaining rows, including other
  owners. An owner-only migration cannot erase another owner's remaining data.
- No prompt has `workflowId`, `workflowStepOrder` or `workflowStepLabel`; no search
  document has `workflowId`; no asset stores `workflow_asset`.
- Every approved native Skill has its exact source metadata (apart from recorded
  cover repairs), ordered prompts, step/body examples and collection filing.
- Old copied Skill/Workflow and retired pack identifiers resolve under their owner
  for get/update/delete/filing; alias resolution fails for other owners.
- Pending pre-migration reindex calls have drained or been safely remapped.

Then remove the old table definitions/indexes, legacy prompt/search fields,
temporary reindex bridge and source-writing migration functions in a reviewed
follow-up. Keep permanent aliases/private snapshots and native verification
receipts. Remove the staged `prompt.workflowId` pack-sync guard at that point.
Native step edits must still skip automatic pack recreation; new multi-media
ingest retires its transient side-effect pack after linking the native step.

Run lint and typecheck; do not run tests when the owner prohibited them. Publish
the reviewed final backend, verify no legacy table/API remains, and update the
receipt with the actual state. Do not describe empty staging tables as removed.

Removing schema definitions does not necessarily remove physical tables. After
deployment-wide zero-row verification and the final schema publication, use
Convex's official dashboard table-retirement operation only for the exact
approved empty table names:

```http
POST <deploymentUrl>/api/delete_tables
Authorization: Convex <authorized deployment admin key>
Content-Type: application/json

{"tableNames":["workflows","workflowFolders"],"componentId":null}
```

This operation also deletes nonempty tables: the operator must enforce the
zero-row and preservation checks before calling it. It requires WriteData
permission; the active schema must omit both definitions and all typed references
to them. Verify both names are absent from `convex data` with no table argument
(the official paginated `_system/cli/tables` query reads the active table registry).
An empty listed table is still an active backend object. Platform retention of
internal history is separate from removal of active gallery tables. Keep the
credential outside the repository and out of command output or receipts.

The request contract is documented by the [official dashboard implementation](https://github.com/get-convex/convex-backend/blob/02fe59be03b7892072d95229ab82c310a15fb222/npm-packages/dashboard-common/src/features/data/lib/api.ts#L5-L29),
with [schema checks](https://github.com/get-convex/convex-backend/blob/02fe59be03b7892072d95229ab82c310a15fb222/crates/common/src/schemas/mod.rs#L483-L512)
and [active-table listing](https://github.com/get-convex/convex-backend/blob/02fe59be03b7892072d95229ab82c310a15fb222/npm-packages/system-udfs/convex/_system/cli/tables.ts#L5-L20).
