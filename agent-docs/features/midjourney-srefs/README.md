# Midjourney sref library

Keep liked Midjourney styles in a normal private collection named `Midjourney
Srefs`. Opening it shows reusable recipes, example thumbnails, source links,
full prompts and copy buttons. A form saves codes without placeholder images.
Searching covers codes, notes, source URLs and example prompts.

The backend reads all direct collection memberships through existing indexes.
It extracts `--sref` from source prompts, or from bookmark ALT/text when the
original media has not been saved. Recipes retain `--sw`, `--sv` and `--v`.
Distinct parameter combinations remain separate, including version changes.
Numeric codes remain strings and weighted mixtures retain their ordering.
`random` is excluded because it does not identify a reusable style.

Text recipes use the existing prompts table, `domain: midjourney-sref` and
`promptSections.finalPrompt` for the exact reusable parameters. The existing
`generationNotes` string contains JSON with title, note and sourceUrl. The
owner/collection/parameters ingest key makes exact retries idempotent. Re-saving
does not overwrite the first note; metadata edits use the existing prompt update
contract. Ordinary media and publication state remain in their existing records.
This feature adds no table or schema migration.

`/api/agent/srefs` exposes list/save with gallery:read/gallery:write scopes.
The shared hosted/stdio MCP registry exposes `list_srefs` and `save_sref`.
The master gallery skill and discovery manifest describe both operations.

Validate parsing, version separation, owner isolation, note preservation and
collection readback with focused Bun tests, lint and TypeScript. Publishing new
Convex functions and the Next.js UI requires authorized deployment. An ordinary
collection and its saved media are usable before those changes are deployed.
