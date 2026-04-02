# PRD: Pack Gallery Support

## Goal

Make gallery packs behave like first-class entries instead of showing every pack member as an independent card.

## Problem

- The schema already supports `assetPacks`, `assetPackId`, and `packSlotIndex`.
- The gallery feed still fetches asset rows and flattens them into individual cards.
- Legacy multi-image entries are often represented only by shared `promptId`, not by explicit packs.
- Asset create/update/delete flows do not consistently repair pack membership, so pack state can drift.

## Scope

### Backend

- Auto-sync prompt-linked assets into packs when a prompt has multiple assets.
- Backfill legacy prompt groups into explicit `assetPacks`.
- Keep pack membership correct on asset create, asset prompt reassignment, prompt metadata update, and asset delete.
- Keep pack cover deterministic and ordered.

### Frontend

- Render one gallery card per pack cover instead of one card per asset member.
- Add pack hover preview cycling through member images.
- Preserve detail-panel carousel behavior for pack members.
- Keep standalone assets unchanged.

## Non-goals

- New pack editing UI.
- New ingest payload fields for pack creation.
- Replacing the current detail panel with a separate pack page.

## Data rules

- A pack is created when a prompt has 2+ linked assets.
- Pack ordering is newest-first.
- Pack cover is slot `0`.
- A prompt with fewer than 2 linked assets should not retain a pack.
- Pack metadata should mirror the linked prompt/cover asset enough for gallery display:
  - title from prompt text
  - pillar/domain/model from prompt when available
  - cover asset from newest asset
  - item count from linked members

## Acceptance criteria

- Legacy prompt groups can be consolidated into explicit packs through a backend mutation/action.
- New multi-asset ingests auto-land in packs without a separate manual step.
- Deleting or reassigning an asset repairs the remaining pack state.
- The gallery grid shows a single card per pack with a member count badge.
- Hovering a pack card cycles through its member images.
- Opening a pack card still shows the full member carousel in the detail panel.
