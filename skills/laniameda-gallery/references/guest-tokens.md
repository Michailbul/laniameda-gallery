# Guest reader tokens

A guest reader token lets a collaborator's agent **look at chosen shelves of
the gallery and nothing else**. It cannot save, edit, delete, generate or
upload, and it never sees a world. First minted 12 Nov 2026 for a collaborator's
car-channel agent.

## What a guest sees

- **Collections**: the token's allowed root collections (`allowedRootIds`) and
  their children. Every other root is hidden, so a root created later starts
  hidden. A world root (`worldKey`, a universe member or a project) is never
  open, even if it is put on the allowlist; the backend refuses to mint one.
- **Pieces and Skills** (deny wins): visible only when filed in at least one
  visible collection **and** in no hidden one. A piece in ART and in a world,
  or in a car shelf and in LOVE, is hidden everywhere. A piece or Skill with no
  collection is hidden.
- **YouTube video references**: open in full (`list_video_refs`,
  `list_video_refs_page`, `get_video_ref`).
- A hidden piece reads exactly like a missing one (`asset: null`, "Asset not
  found.", or listed under a contact sheet's `missingIds`). Search summaries
  carry only `mode` and `note`; listings carry no vault-wide counts;
  collections carry no member counts.
- Never served: likes, super likes, stars and star notes, comments,
  characters, other capture sources, private inspiration originals, tasks,
  inbox, newspaper, Midjourney queue and srefs, stories, moodboards, styles,
  projects, director review, production briefs, locked prompts, tags and menu
  filters, bookmarks, private skill references and world rules. Media embedded
  in a visible Skill is dropped when that media is filed anywhere hidden.

## Tools a guest token is offered

`check_connection`, `list_collections`, `search_gallery`, `list_assets`,
`list_assets_page`, `find_similar`, `preview_assets`, `get_gallery_item`,
`list_skills`, `search_skills`, `get_skill`, `list_video_refs`,
`list_video_refs_page`, `get_video_ref`. The hosted MCP registers only these;
every other `/api/agent/*` action refuses the token with HTTP 403. Media URLs
in results are the same direct links the owner gets.

## For the owner: mint, list, revoke

A guest token has the single scope `guest:read`; the `/agents` form and OAuth
never offer it, and its reach cannot be edited (revoke and mint again).
From a gallery checkout, with the deployment's issuer secret and owner id in
the environment (never printed):

```bash
export CONVEX_DEPLOYMENT=dev:perfect-buffalo-375
export CONVEX_URL=https://perfect-buffalo-375.convex.cloud
export AGENT_TOKEN_ISSUER_SECRET="$(bunx convex env get AGENT_TOKEN_ISSUER_SECRET)"
export GALLERY_OWNER_USER_ID="$(bunx convex env get KB_OWNER_USER_ID)"

bun scripts/guest-token.ts mint --label "Name · purpose (read-only)" \
  --roots <rootId>,<rootId> --out ~/.config/laniameda/<name>-gallery-token
bun scripts/guest-token.ts list
bun scripts/guest-token.ts revoke --id <tokenId>
```

`mint` writes the raw token only to `--out` (mode 600) and prints the token
id and prefix. Hand the file's contents to the collaborator privately. Revoking
works at once; the token also shows on `/agents` (label "Guest: look only,
chosen shelves") with its Revoke button.

The collaborator's agent connects to `https://gallery.laniameda.space/api/mcp`
with `Authorization: Bearer <token>`.
