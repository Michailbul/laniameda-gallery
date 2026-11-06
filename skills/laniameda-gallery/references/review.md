# Director review: rounds of frames an outside director reviews

A review project shows frames to someone outside the studio and collects what
they think. The first one is CASSANDRA, the animated feature: its director
opens `https://www.mishabuloichyk.com/cassandra` (the gallery serves it at
`/review/cassandra`), signs in with Google and likes, dislikes and comments on
frames. Michael opens the same page as the owner: through his gallery session
on `gallery.laniameda.space`, or on the public address with a Google account
listed in the project's `ownerEmails`. He also sees the draft round and each
frame's making-of.

Agents prepare rounds, read what the director said and answer. Publishing,
rolling back and choosing who may look stay Michael's calls.

## The objects

- **Project** (`slug`, e.g. `cassandra`): title, subtitle, the gallery world
  the frames come from, its public address (`publicUrl`), reviewers, owner
  emails and the style carousel. `cassandra-test` is the test project; try
  things there, never on the real one.
- **Reviewer**: a Google account (email) with a role. `director` likes,
  dislikes and comments; `viewer` only looks. Anyone not on the list is
  refused. A reviewer without a Google account can get a private sign-in link
  (30 days) that Michael sends himself.
- **Folder**: where frames sit in the left nav, in one of three sections:
  `locations`, `characters`, later `scenes`. A folder has a name, a slug, an
  area that groups it ("San Pancho", "Mexico City", "Main cast"), one plain
  note for the director and the script scene numbers it appears in. Archiving
  hides a folder; only a folder with no frames in any round can be deleted.
- **Style**: a world style (`style:<id>`, see references/styles.md) offered in
  the carousel. The director sees only its label ("Night storybook") and a
  cover; the recipe (moodboards, profiles, prompts) stays on the world style
  and only Michael and agents read it. A hidden style stays in the project
  but the director does not see it.
- **Round**: a version, `v0.1`, `v0.2` … Each round holds its own items, so an
  older round stays exactly as it was shown. A round is a `draft` (being
  prepared, only Michael sees it) or `published`. One published round is
  `current`: what the director sees by default. There is at most one draft.
- **Item**: a frame in a round: the asset, its folder, its style, an optional
  caption the director reads, and earlier takes it replaced. One frame may sit
  in two folders (a place and a person).
- **Verdict**: one like or dislike per frame per person. It belongs to the
  frame (the asset), not the round, so a like carries into the next round.
- **Comment**: text on a frame by the director, a viewer, Michael or an agent
  ("Studio agent"). One comment written on several frames at once is one row
  per frame. A comment can be resolved (handled) and reopened.

Every frame has a short code, `CA-` and the last six characters of its asset
id (`CA-8HQF6Z`). The director quotes these codes. The tools accept a code
wherever they take a frame; when one code names two frames they say so, and
you use `asset:<id>` instead.

## Tools

| Tool | What it does |
|---|---|
| `review_open` | Every project, or one: settings, reviewers, styles with recipes, folders with frame counts, rounds. |
| `review_items` | The frames of a round (default: the draft, else the current one), by folder, section or style; with `frame`, its making-of. |
| `review_feedback` | Likes, dislikes and comments, newest first, with code, folder and style; a per-frame summary; one frame's thread. |
| `review_setup` | `op` project, folders, reorder_folders, delete_folder, invite. |
| `review_promote` | Gallery frames into the draft round, by folder and style; `dryRun` suggests. |
| `review_organize` | `op` move, remove, reorder, replace in the draft round. |
| `review_round` | `op` draft, publish, set_current, discard_draft. |
| `review_comment` | `op` add (reply as the studio agent), resolve, reopen, delete, mark_seen. |

All of them call `POST /api/agent/review` with an `action`. Reads need
`gallery:read`; changes and invite links `gallery:write`; deleting a draft
round, an empty folder or a comment `gallery:delete`.

Names resolve for you: a folder by id, slug or name (add `section` when a
slug is in two sections); a style by `style:<id>`, its review label or the
world style's name, any case; a round as `"draft"`, `"current"`, `"v0.2"` or
`2`.

## The round lifecycle

1. **Draft.** The first promote starts a draft as a copy of the current round
   (or `review_round {op: "draft"}` starts it now; `round` copies an older
   one instead). Everything an agent changes lands in the draft. The director
   sees nothing of it.
2. **Publish.** `review_round {op: "publish", title, note, confirmed: true}`
   makes the draft the current round. The title and note tell the director
   what changed, in plain words. Frames not in the round before show as new.
3. **Roll back.** `review_round {op: "set_current", round: "v0.1",
   confirmed: true}` shows an earlier published round instead; the same call
   goes forward again. Nothing is lost.
4. **Discard.** `review_round {op: "discard_draft", confirmed: true}` throws
   the draft and its items away. Published rounds are untouched.

`confirmed: true` means Michael said to do it in this session. Without it the
call is refused. Never publish, roll back or discard on your own judgement,
and never on the real project to test something.

## Prepare a round from a world

1. `review_open {project}`: the styles in the carousel, the folders, the
   draft if there is one. `open_world` and `list_styles` give the world's
   own styles and shelves.
2. A style the round needs but the carousel lacks: add it with
   `review_setup {op: "project", styles: [...]}`, every style in carousel
   order, with the label Michael chose. Missing folders:
   `review_setup {op: "folders", folders: [{section, name, area, note}]}`.
   Repeating a folder's name updates it, never doubles it.
3. Find the frames: a style's frames with `get_style {style, frames}`,
   frames of a place or person with `search_gallery` / `list_assets_page`
   inside the world. Only frames Michael kept go in.
4. `review_promote {project, frames, dryRun: true}` shows each frame's
   suggested folder (a folder named like one of its shelves) and style (the
   review style whose shelf holds it) and whether it is already in a round.
5. Promote: `review_promote {project, frames, folder, style}` per folder.
   Leave `folder` out to use the suggestions; frames with none come back as
   `unplaced`. Leave `style` out to use the shelf's style. A frame already in
   that folder of the draft is updated, never doubled.
6. Check with `review_items {project, round: "draft"}` and look at the
   pictures with `preview_assets`. Arrange with `review_organize` (move,
   remove, reorder).
7. Show Michael what the draft holds (pictures, plain words) and wait for his
   go. Then publish with a title and a note.

## Styles are gallery styles

A review style is a world style (`list_styles`, `get_style`), never a label
of its own. Promoting a frame into a style, or moving it to another style in
the draft, files it onto that style's shelf in the gallery (and off the
style shelf it left), journaled under the session `review-<project>`, so the
styles page, `get_style` and the review always agree. `world_undo` reverts
it. Frames of another world are skipped, never moved. A style is one exact Midjourney recipe: the same moodboards, profiles and
--sref (Michael, 6 Nov 2026). Frames made with a different moodboard or
profile are a different style even when they look alike: read each frame's
prompt, group by its codes, and give every group its own `save_style`
record (recipe, template, covers) before promoting. A style needs at least 8
frames; a recipe with fewer is not a style yet and stays out of the review. Its
own frames wait until there are 8. Edits (Midjourney --edit inpaint, clean-up
edits) keep their source frame's style. A mislabelled frame in a published
round is corrected with `review.restyleInRound`. Director labels are
plain words ("Bright day", "Painted panorama"); recipes and codes stay with
the owner and agents.

## People

Reviewers carry a name and a `title` ("Director · Sula Entertainment",
"Producer · Fantasy Studios"); the page shows their avatars on the frames
they liked or commented on. Add one with
`review_setup {op: "project", addReviewers: [{email, name, title}]}`; a
person with two Google accounts is listed once per email.

## Read the director's feedback and act on it

1. `review_feedback {project, onlyNew: true}` reads what came in since
   Michael last marked it read; `since: <cursor>` reads what is new since your
   own last call. `who: "reviewers"` keeps only the director and viewers.
   `frames` sums it per frame: who liked, who disliked, open comments.
2. A dislike or a comment asking for a change is work: a targeted edit
   (`edit_asset`) or a new generation in the frame's style, saved in the
   world as usual. A like is a keep: do not regenerate it.
3. Put the new take in the draft with
   `review_organize {op: "replace", items: [code], with: "asset:<new>"}`. The
   old take stays as the frame's earlier version; its likes and comments stay
   on the old asset.
4. Reply under the frame with `review_comment {op: "add", frames, body}` in
   plain words ("New take with the warmer window light, in the next round"),
   and resolve the comment once it is handled. Tell Michael what you did.
5. Leave `mark_seen` to Michael: it clears his unread count.

## Rules

- Publishing, rolling back, discarding a draft, changing reviewers, owner
  emails, the address or the labels: only on Michael's word.
- Never like or dislike. Verdicts are the director's and Michael's.
- Invite links go to Michael; he sends them. Never email or post one.
- Everything the director reads is plain words: labels, captions, folder
  notes, round titles and notes, agent replies. No ids, tool names, prompts,
  model names, flags or codes other than the frame codes he already sees.
- Test on `cassandra-test`. Read the real project freely; change it only for
  Michael's actual round.
