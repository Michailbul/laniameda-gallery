# PRD: Pack Gallery Support

## Goal

Make gallery packs behave like first-class entries instead of showing every pack member as an independent card.

## Problem

- The schema already supports `assetPacks`, `assetPackId`, and `packSlotIndex`.
- The gallery feed still fetches asset rows and flattens them into individual cards.
- Legacy multi-image entries are often represented only by shared `promptId`, not by explicit packs.
- Asset create/update/delete flows do not consistently repair pack membership, so pack state can drift.
- (2026-09-26) The same prompt saved as separate prompt rows, and variations of one prompt, still landed as separate cards: the latest Masa renders ("no drama", "be part of something") sat side by side as near-twins.

## Scope

### Backend

- Auto-sync prompt-linked assets into packs when a prompt has multiple assets.
- Backfill legacy prompt groups into explicit `assetPacks`.
- Keep pack membership correct on asset create, asset prompt reassignment, prompt metadata update, and asset delete.
- Keep pack cover deterministic and ordered.

### Frontend

- Render one gallery card per pack cover instead of one card per asset member.
- Fold prompt families (same prompt text across rows, and variations of it) into one pack.
- Render packs as stacked, self-rotating decks with carousel tabs.
- Preserve detail-panel carousel behavior for pack members, with a dedicated expanded-view design.
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

## Prompt families (2026-09-26)

Rules live in `lib/prompt-family.ts`, pure and importable by Convex (`convex/` already imports from `../lib`).

- Fingerprint = the prompt's content words: lowercased, accents folded, URLs and `--flag value` generation parameters (`--ar`, `--seed`, `--v`, …) dropped, English stopwords dropped.
- Placeholder prompts (`lib/prompt.ts` `meaningfulPrompt`) and prompts under 4 content words never group.
- Same fingerprint → same family, at any time distance.
- Variation → token-set Jaccard ≥ 0.6, or ≥ 0.45 with ≥ 85% of the shorter prompt inside the longer; both prompts need ≥ 6 content words; and the family must have a member within 3 days.
- A family is matched against its first 4 distinct prompts only, so one drifting variation cannot chain the vault into a single pack.
- Design bookmarks (`designInspirationId`) and cinema frames never join a family.
- `buildGalleryEntries` groups first by stored pack / prompt row, then folds those groups into families; the newest group supplies the cover.

Current state: families are a read-time grouping over the loaded assets, so every existing row benefits without a backfill. Follow-up when the product earns it: stamp family packs at ingest (`syncPromptAssetPack` is 1:1 with a prompt today, and would need to learn multi-prompt packs before it can do this without evicting members).

## Pack deck (grid)

- Cards behind the front one peek into the gutter (outside the card, whose paint containment would clip them); hover fans them out.
- The front frame rotates every 3.4s, staggered per card, and holds still on hover, off-screen (IntersectionObserver), and under `prefers-reduced-motion`.
- Carousel tabs across the top: one per frame (a single track + counter past 12); the current one fills over the interval, and clicking a tab jumps to it.
- Opening a deck lands the expanded view on the frame that was showing.

## Expanded view (carousel)

- Modal: arrows at the stage edges, filmstrip below the media with `Pack 02 / 05 · N prompt variations`, per-slide fade.
- Mobile sheet: tabs over the image, small arrows, compact filmstrip.
- ←/→ and swipes walk the pack first, then move to the neighbouring card; arrows never navigate while typing in a field.
- The slide index lives in the dashboard (desktop and mobile panels are both mounted), and the live per-asset read follows it: description, tags, star, public, filing, download and delete apply to the frame on show.

## Acceptance criteria

- Legacy prompt groups can be consolidated into explicit packs through a backend mutation/action.
- New multi-asset ingests auto-land in packs without a separate manual step.
- Deleting or reassigning an asset repairs the remaining pack state.
- The gallery grid shows a single card per pack, stacked, with carousel tabs.
- The same prompt saved twice, and variations of one prompt, share one pack card.
- Pack cards rotate through their members on their own; hovering holds them.
- Opening a pack card shows the full member carousel with filmstrip, and actions apply to the visible member.
