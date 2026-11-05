# Character registry

Named people are first-class records. Before this, a person's identity lived
only in conventions: a `character` tag plus a plain name tag, the name on the
caption's first line, a per-character child folder and a hand-kept directory
Story that drifted. The proposal behind this design is CH-SYS in the Dear
Annete art-direction round v1 (16 Oct 2026).

## Data

- `characters`: one row per person per world. `code` is `PREFIX-CH-NNN`
  (`DA-CH-001`), unique per owner and never reissued. Name plus alias is
  unique inside the world (`normalizedName`). Status runs concept, approved,
  sheeted, retired. Costumes are an embedded array (`C01`, `C02`…) with their
  own sheet/face pointers; `lastCostumeNumber` keeps costume codes from being
  reused. `revision` guards edits; `linkCount` is kept by every link write.
- `characterWorlds`: the world's prefix and last issued number. The prefix is
  derived from the world name on the first character (DEAR ANNETE → DA) or
  passed explicitly; two worlds never share one.
- `characterAssets`: typed link (concept, sheet, face, costume, appears-in,
  reference) with an optional costume code. One row per character and asset.
  Setting a sheet/face pointer creates the row; unlinking clears the pointer.
  `deleteAssetCascade` drops an asset's rows and pointers.

All functions are `signedOwnerQuery` / `signedOwnerMutation` in
`convex/characters.ts`. Characters are addressed by code or `character:<id>`.

## Surfaces

- `/api/agent/characters`: list, get, forAsset (read); create, update,
  costume, removeCostume, link, unlink (write); delete (gallery:delete).
- MCP: list_characters, get_character, create_character, update_character,
  save_character_costume, remove_character_costume, link_character_assets,
  unlink_character_assets, delete_character. get_gallery_item on an asset also
  returns `characters`. Contract 2026-10-16.1.
- Skill: references/characters.md (skill 1.9.0); storybook CAST cites codes.
- UI: sidebar → Characters. Cast grid by world and status with copyable codes;
  a character page with master sheet, face, costumes, linked-asset masonry,
  paste-to-link and "Make main" to promote a sheet/face. The asset detail panel
  lists the people linked to the asset.

## Not in this change

Existing Dear Annete assets are not migrated or relinked. That waits until
Michael approves the cast names on the art-direction explorer. Later work:
a characterId filter on list_assets_page/search, merge/split tools, and a cast
picker in storybooks.

## Verification

`tests/characters.test.ts` (codes, idempotent create, never-reused codes,
prefix rules, revision guard, costumes, links, cascade, owner privacy), route
and MCP contract tests. Exercised end to end on an isolated local Convex
backend with a throwaway signing key: UI create/link/promote/costumes, hosted
MCP tool calls, asset delete cascade, phone width and light theme.
