# Director review (6 Nov 2026)

Branch `feat/director-review`. The CASSANDRA animated feature gets a review
page for its director, Alejandro Sugich. This file holds what the code does
and what it does not; the agent contract is
`skills/laniameda-gallery/references/review.md`.

## Goal

The director opens one address on his phone or laptop, signs in with Google,
and looks through the frames of the current round by place, by person and by
style. He likes, dislikes and comments on frames (one comment on several at
once). Michael and agents see what he said, make new takes, and ship the next
round. Older rounds stay viewable; a bad round can be rolled back.

## What shipped

### Data (convex/reviewValidators.ts, convex/schema.ts)

Six tables: `reviewProjects`, `reviewFolders`, `reviewVersions`,
`reviewItems`, `reviewFeedback`, `reviewComments` (fields and indexes in
`skills/laniameda-gallery/references/data-model.md`). Each round owns its
items; a draft starts as a copy of a round's items, so a published round never
changes. Verdicts and comments are keyed by asset, so they follow a frame from
round to round.

### Backend (convex/review.ts)

- Viewer functions resolve the caller themselves: `page` (one round with the
  folder tree, style carousel, rounds and every item, in one read), `access`,
  `feedback` (verdicts and comment counts, live), `comments` (one thread),
  `setVerdict`, `addComment`, `deleteComment`, `resolveComment`,
  `recordVisit`, `markFeedbackSeen`, `itemDetail` (owner only: prompt,
  model, Midjourney data, style recipe), `signInCard`.
- Owner-scoped (`signedOwnerQuery` / `signedOwnerMutation`): `overview`,
  `listItems`, `feedbackFeed`, `promoteTargets`, `upsertProject`,
  `upsertFolder`, `reorderFolders`, `deleteFolder` (only a folder with no
  frames in any round), `promote`, `updateItems`, `removeItems`,
  `reorderItems`, `replaceItemAsset`, `createDraft`, `publishDraft`,
  `setCurrentVersion`, `discardDraft`, `ownerComment`, `ownerResolveComment`.
- Promote lands in the draft (made from the current round when there is none).
  A frame already in that folder of the draft is updated, never doubled.
  Without a style, the review style whose shelf holds the frame is used.
- Replace keeps the earlier take in `previousAssetIds`.

### Sign-in (lib/server/review-auth.ts, app/review/[slug]/api/auth/*)

- Reviewers sign in with Google Identity Services. The server checks the ID
  token, asks Convex whether the email may open the project, and sets
  `rv_session` (30 days, signed with a key derived from `SESSION_SECRET`, so it
  never passes for the gallery's `tg_session`).
- The page's Convex client fetches hour-long tokens with subject
  `reviewer:<email>`. `convex/actor.ts` refuses that subject in every gallery
  function; only `convex/review.ts` reads it.
- Michael needs no Google sign-in on the gallery domain (his Telegram session
  names him). On the public address he signs in with an email in
  `ownerEmails`.
- Invite links: a 30-day signed link for a listed reviewer without a Google
  account (`/api/auth/invite?token=…` under the project's address). Michael
  sends it himself.
- Local development only: `/review/<slug>/api/dev-as` switches the page
  between the test director (`director.test@example.com`) and the owner.

### The page (app/review/[slug], components/review)

Served at `/review/<slug>` and, through the other site's rewrite and the
`/gallery-assets` asset prefix (next.config.ts, proxy.ts), at
`https://www.mishabuloichyk.com/cassandra`. Signed out: a sign-in card with the
title and one frame. Signed in: the round is read on the server with the
viewer's token so the first paint has every frame, then it subscribes live.
Justified rows at honest aspect ratios, folders in a left nav by section and
area, the style carousel, the round timeline, verdicts and comments, and an
originals download route (one file, or a ZIP streamed on the fly). The UI
agent's files hold the details.

### Promote from the gallery (components/review-promote, lib/asset-hotkeys.ts)

R on a frame (or a selection) opens the promote palette; Shift+R sends it to
the last destination of its review project. Frames land in the draft round.

### Agents (app/api/agent/review/route.ts, lib/review-contract.ts)

One route, `POST /api/agent/review` with `action`:

| Action | Backend | Scope |
|---|---|---|
| `open` | overview; without project, every project (promoteTargets + overview) | read |
| `items` | listItems, itemDetail with `frame` | read |
| `feedback` | feedbackFeed; with `frame`, comments + feedback | read |
| `targets` | promoteTargets | read |
| `project` | upsertProject (world resolved by key or name; styles by id, label or name) | write |
| `folder` | upsertFolder, batched | write |
| `reorder_folders` | reorderFolders | write |
| `delete_folder` | deleteFolder | delete |
| `invite` | `reviewInviteUrl` (publicUrl, else `<origin>/review/<slug>`) | write |
| `promote` | promote, per suggested folder when no folder is given; `dryRun` = targets | write (dryRun read) |
| `move`, `remove`, `reorder`, `replace` | updateItems, removeItems, reorderItems, replaceItemAsset | write |
| `draft` | createDraft | write |
| `publish`, `set_current` | publishDraft, setCurrentVersion; refused without `confirmed: true` | write |
| `discard_draft` | discardDraft; refused without `confirmed: true` | delete |
| `comment`, `resolve_comment` | ownerComment (author agent), ownerResolveComment | write |
| `delete_comment` | deleteComment | delete |
| `mark_seen` | markFeedbackSeen | write |

The route resolves handles so agents never look up ids first: frames as
`asset:<id>`, bare ids or codes `CA-XXXXXX` (searched in the project's rounds,
newest first; a code that names two frames is refused); folders by id, slug or
name (+ section); styles by `style:<id>`, review label or world style name, any
case; rounds as `draft`, `current`, `v0.2`, `0.2` or `2`. Replies carry
`asset:<id>` handles, codes, folder slugs and style labels.

MCP tools (mcp/laniameda-gallery/tools.ts, shared by the stdio server and the
hosted `/api/mcp`): `review_open`, `review_items`, `review_feedback` (read
only); `review_setup` (op project, folders, reorder_folders, delete_folder,
invite), `review_promote`, `review_organize` (op move, remove, reorder,
replace), `review_round` (op draft, publish, set_current, discard_draft),
`review_comment` (op add, resolve, reopen, delete, mark_seen). Skill 1.30.0
adds `references/review.md`.

## Rules the code enforces

- Only listed reviewers and owner emails open a project; a reviewer token
  opens nothing else in the gallery.
- Viewers look; only directors and the owner vote and comment.
- Feedback is taken only on frames that are in some round of the project.
- Publish needs a non-empty draft. Set current needs a published round.
- A folder with frames in any round cannot be deleted; archive it.
- Agents cannot vote (no action for it), and publish, set_current and
  discard_draft need `confirmed: true`.

## Verified (6 Nov 2026, dev server on :3318 against dev:perfect-buffalo-375)

Every route action ran against `cassandra-test`, through the route, the
hosted MCP endpoint and the stdio server: open (list and one), items (round,
folder, style, frame detail by code), feedback (all, since, onlyNew,
who reviewers, one frame), targets, project (style added by name and label,
reviewer added and removed), folder (create, repeat create = update, archive,
unarchive), reorder_folders, delete_folder (refused on a folder with frames,
then two empty test folders deleted), invite (link opens: sets the review
cookie and redirects to the page; refused for a non-reviewer), promote
(dryRun, auto placement with unplaced frames, explicit folder and style,
re-promote updates), move, reorder, replace (earlier take kept), remove,
comment, resolve, reopen, delete_comment, mark_seen, draft, publish,
set_current back to v0.1 and forward to v0.2, discard_draft, draft from a
round. A test director's like, dislike and comment (signed through the
page's dev sign-in) came through `review_feedback`; they were cleared after.
`tests/review-mcp.test.ts` covers the tool set, annotations and op mapping.

`cassandra-test` was left with v0.1 and v0.2 published (v0.2 current, 39
frames: the first 31 plus 8 Night storybook frames), a draft v0.3 copied from
v0.2, the style "Night storybook (test)" in the carousel, and no feedback.
The real `cassandra` project was only read.

## Not built / known limits

- Frame codes are `CA-` plus the last six characters of the asset id. Convex
  ids end in a nearly fixed tail (`8h…` on every asset seen), so only about
  four characters vary and two frames can share a code once a project holds a
  few hundred. The agent route refuses an ambiguous code; the page shows it
  as is. A code from a hash or from the id's varying middle would fix it.
- `listItems` returns no thumbnails; agents look with `preview_assets`.
- Promote suggestions match folder slugs to the asset's shelf names only.
- `feedbackFeed` limits verdicts and comments separately (default 200 each).
- Owner verdicts (Michael voting as himself) exist in the backend but have no
  agent action, on purpose.
