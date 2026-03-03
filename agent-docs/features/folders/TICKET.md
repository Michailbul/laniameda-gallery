# Feature Ticket: Owner-Scoped Folders Backend

Status: Completed
Owner: Backend
Date: 2026-03-03

## Scope

Implement owner-scoped folder backend with assignment APIs and permission enforcement.

## Checklist

- [x] Add owner + normalization fields and indexes to `folders` schema
- [x] Add folder ownership helper utilities
- [x] Refactor folder functions to owner-scoped CRUD
- [x] Add `assets.setAssetFolder` mutation
- [x] Enforce folder ownership checks in prompt/asset writes
- [x] Update dashboard folder query to pass `ownerUserId`
- [x] Add backend lifecycle + authorization tests
- [x] Validate with `bunx convex dev --once`
- [x] Validate with `bun run lint`
- [x] Validate with `bun test`

## Notes

- Existing legacy folders without `ownerUserId` are intentionally not surfaced by owner-scoped listing.
- Follow-up work: migration utility + folder management UI.
