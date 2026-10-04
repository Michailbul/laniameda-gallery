# PRD: Packaging Previewer (thumbnail × title boards)

Drafted 4 Oct 2026 from the Lamborghini film's thumbnail work (explainers repo, `lamborghini/long/thumbnails/lab/`),
where a one-off page proved the workflow: see every thumbnail with every title in a YouTube feed, on desktop and
phone, dark and light, and pick the pair to upload.

## Goal

A board in the gallery where Michael previews YouTube packaging (thumbnail + title) the way a viewer meets it, and
an agent can build, change and read that board through MCP. The agent makes variants; Michael clicks through them;
the agent reads his picks and makes the next round.

## Problem

- Thumbnail rounds today are scattered HTML pages and contact sheets outside the gallery. The renders are not in the
  vault, the picks live in browser storage, and an agent in a new session can't find either.
- The thing that decides a packaging choice, the pair in context (feed, phone, small sizes, title cut-off), is
  rebuilt by hand for every video.
- The `/youtube` area already holds the research side (video refs, packaging wall) but nothing for our own videos.

## The board, in plain words

One board per video. It holds:

- **Directions**: named groups such as "Ferrari's mistake", "They laughed", "The boy". A thumbnail and a title each
  belong to one direction, and the rail shows one direction at a time.
- **Thumbnails**: gallery assets (saved like any other render, `assetRole: generated_output`) with a short label.
- **Titles**: text options with an optional note (why, which pattern, source data).
- **Competitors**: the real thumbnails that sit around ours in the mock feed. They are `videoRefs`, chosen by label
  (for example `youtube-history-docs`) or by id, so the feed shows the market we compete in.
- **Presets**: saved views to click through: a mode (feed, compare grid, small sizes), a device (desktop, phone,
  both), a YouTube theme (dark, light), a focus pair and, for the grid, the ticked thumbnails and titles. An agent
  writes them ("Red vs white, top 3 titles"), Michael steps through them with ← and →.
- **Picks**: what Michael keeps: starred thumbnails, starred titles, one chosen pair, and a note. Agents read this.
- **Video meta**: channel name, avatar asset, duration, used to draw the card.

## UX

Route: `/youtube/boards` (list) and `/youtube/boards/[id]` (board), inside the existing YouTube layout and gate.

- **Top bar**: the board title; the preset chips (click one, or ← →); mode / device / theme switches; Share and
  "Copy agent handle" (`board:<id>`).
- **Left rail**: direction tabs; thumbnails as small tiles (click to preview, corner box to add to the grid, star to
  keep); titles as editable rows with a live character count (green ≤50, amber ≤60, red >60) and a star; add a title
  inline; drop or paste an image to add a thumbnail (saves it to the gallery first).
- **Stage**
  - *Feed*: desktop home feed (3 columns, ours in slot 2 among competitors) and a 390 px phone feed side by side;
    real YouTube metrics (12 px radius, 2-line clamp, 16/22 type on desktop, duration chip).
  - *Compare grid*: every ticked thumbnail × every ticked title as cards at feed size.
  - *Small sizes*: search row (360 px), up-next sidebar (168 px), 120 px and 96 px, to test legibility.
- **Pick**: "Choose this pair" on the focused combination writes the pick; the board shows it as the winner.
- Changes save to Convex as they happen; an agent's edit appears live (Convex subscription), so Michael can watch a
  round arrive.

## Data model

New table `packagingBoards` (new file `convex/packagingBoards.ts`, `ownerQuery`/`ownerMutation` throughout):

```ts
packagingBoards: defineTable({
  ownerUserId: v.string(),
  title: v.string(),                       // "Lamborghini — Ferrari's mistake"
  video: v.object({ channelName: v.string(), avatarAssetId: v.optional(v.id("assets")),
                    durationLabel: v.optional(v.string()) }),
  directions: v.array(v.object({ key: v.string(), label: v.string() })),
  thumbnails: v.array(v.object({ key: v.string(), assetId: v.id("assets"), direction: v.string(),
                                 label: v.optional(v.string()), note: v.optional(v.string()) })),
  titles: v.array(v.object({ key: v.string(), text: v.string(), direction: v.string(),
                             note: v.optional(v.string()), source: v.union(v.literal("agent"), v.literal("user")) })),
  competitors: v.object({ videoRefIds: v.array(v.id("videoRefs")), collectionLabel: v.optional(v.string()) }),
  presets: v.array(v.object({ key: v.string(), name: v.string(),
    mode: v.union(v.literal("feed"), v.literal("compare"), v.literal("sizes")),
    device: v.union(v.literal("both"), v.literal("desktop"), v.literal("phone")),
    theme: v.union(v.literal("dark"), v.literal("light")),
    direction: v.optional(v.string()), focus: v.optional(v.object({ thumbnail: v.string(), title: v.string() })),
    compareThumbnails: v.optional(v.array(v.string())), compareTitles: v.optional(v.array(v.string())) })),
  picks: v.object({ thumbnails: v.array(v.string()), titles: v.array(v.string()),
                    pair: v.optional(v.object({ thumbnail: v.string(), title: v.string() })),
                    note: v.optional(v.string()), updatedAt: v.optional(v.number()) }),
  createdAt: v.number(), updatedAt: v.number(),
}).index("by_owner_updatedAt", ["ownerUserId", "updatedAt"])
```

Keys inside the board (`th_…`, `ti_…`, `pr_…`) are stable short ids so presets and picks survive edits. Thumbnails
reference assets, never copies, so a board never holds media the vault doesn't.

## Agent surface (MCP)

One route, `app/api/agent/packaging-boards/route.ts` (action switch, `SCOPE_BY_ACTION`, registered in
`lib/server/mcp-agent-routes.ts`), and four tools in `mcp/laniameda-gallery/tools.ts`:

| Tool | Does | Scope |
|---|---|---|
| `list_packaging_boards` | Boards with title, counts, picks summary, `updatedAt` | read |
| `get_packaging_board` | One board in full, with resolved thumbnail URLs and Michael's picks | read |
| `create_packaging_board` | New board from a title, directions, optional thumbnails/titles/presets | write |
| `update_packaging_board` | A list of ops applied in order: `addThumbnails`, `removeThumbnails`, `addTitles`, `updateTitle`, `removeTitles`, `setDirections`, `setPresets`, `setCompetitors`, `setVideo`, `clearPicks` | write |

An agent round looks like: render variants → `save_assets` (tags `youtube-thumbnail` + the video's tag) →
`update_packaging_board` with `addThumbnails` and a preset per comparison → Michael clicks through → the next session
calls `get_packaging_board` and reads `picks`. Agents never write `picks` (only `clearPicks` on request); picks are
Michael's.

Server instructions (`GALLERY_MCP_INSTRUCTIONS`) gain three lines: what a board is, that thumbnails must be saved as
assets first, and that picks are read-only for agents.

## Phases

1. **Backend**: schema, `convex/packagingBoards.ts` (queries, ops mutation, validators), the agent route, MCP tools,
   tests (`tests/packaging-boards.test.ts`; function-surface test stays green), skill docs
   (`skills/laniameda-gallery/references/data-model.md`, a short "Packaging boards" section in `query.md`).
2. **Board page**: list + board UI on the YouTube layout, reusing `components/youtube/video-card.tsx` and the
   `--lm-*` tokens; presets with ← →; live Convex updates.
3. **Import**: the Lamborghini lab (3 directions, ~40 thumbnails, the researched titles, the winners as presets)
   saved as the first board, which doubles as the end-to-end test.

## Non-goals (this round)

- Rendering thumbnails in the gallery (they're made in Remotion / image models and saved as assets).
- Uploading to YouTube or reading real A/B test results (a later phase could add a "results" field).
- Sharing a board publicly; boards are owner-only like the rest of `/youtube`.

## Open questions for Michael

- Route under `/youtube` behind the existing gate (proposed), or a top-level gallery page?
- Should a board also be able to hold short-form (9:16 Shorts covers)? Cheap to add as a second card shape later.
