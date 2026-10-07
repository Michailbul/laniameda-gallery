# Bookmarks: X posts with their text

A bookmark is a post from x.com kept with what it says: author, full text,
quoted post, media, counts, and Michael's own note. Use it whenever he shares a
post link, says "bookmark this", or a post is worth keeping for its words
(an announcement, a technique, a prompt thread), with or without media.

## What gets stored

- One row per post in the `bookmarks` table (`convex/schema.ts`,
  `bookmarkPostFields` in `convex/validators.ts`). Id reads `bookmark:<id>`.
- The post's gallery pieces point at it through `asset.bookmarkId`:
  - **No piece yet**: the save creates a preview asset, `assetRole: "bookmark"`,
    from the first image or the video's poster frame (a text post stores the
    author's avatar). It renders as a post card everywhere.
  - **Media already saved** (assets whose `sourceUrl` is the post's permalink):
    those assets are linked to the post and nothing is copied. They keep their
    role, collections and description, stay media tiles in the main grid, and
    gain the post in the detail panel and in search.
- Every piece of a bookmarked post carries the tag `bookmark`. The island bar's
  **Bookmarks** pill filters on it and shows each post once, as a post card.
- The post text, author, quoted post and note are part of the asset's search
  text lane, and of the vault's keyword search.

## Save

Send the link. The gallery reads the post itself from public endpoints.

```bash
bun <this skill>/scripts/gallery.mjs save_bookmarks \
  '{"items":[{"url":"https://x.com/<handle>/status/<id>","agentDescription":"…"}]}'
```

MCP: `save_bookmarks` with the same `items` (up to 12 per call).
Local/admin bookmarks.ts remains a signed-owner compatibility path; hosted
MCP or the token-only gallery.mjs client is preferred.

Per item:

| Field | Use |
|---|---|
| `url` | Required. Any x.com / twitter.com permalink; query strings are dropped. |
| `agentDescription` | What the post is about and why it was kept, `by @handle`. Applied when the save creates the post card; linked media pieces keep their own. |
| `userNote` | Only Michael's own words about the post. |
| `folderIds` | Collections. Only when he names one. |
| `tagNames` | Extra tags. `x` and `bookmark` are added by the save. |
| `assetIds` | Pieces to link, when their `sourceUrl` is not the permalink. |
| `text`, `authorName`, `authorHandle`, `postedAt`, `media` | Only when the post cannot be read publicly (deleted, private, age-gated). Read them off the page in the browser. |

The result reports per post: `bookmarkId`, `assetId`, `linkedAssetIds`,
`created`, `fetched` (false means the gallery could not read the post and used
what you sent). Saving the same post again refreshes its text and counts and
never makes a second card.

## Find

- **By words in the post**: `bookmarks.ts '{"action":"list","search":"alpha matte"}'`
  or MCP `list_bookmarks`. Every word must appear in the text, author, quote or
  note. Also takes `authorHandle`, `folderId`, `limit`. Returns the full text.
- **By meaning**: query `search` with `"tagNames":["bookmark"]`. Each result
  that came from a saved post carries `post` (author, text, note).
- **Browse**: `list` with `"tagNames":["bookmark"]`.

## Note

`bookmarks.ts '{"action":"note","id":"bookmark:<id>","userNote":"…"}'` or MCP
`set_bookmark_note`. An empty note clears it.

## Delete

Delete the asset (`references/ingest.md`). The bookmark goes with its last
piece; while other pieces of the post remain, it moves to one of them.

## Limits

- X only. Threads are saved as their first post.
- A video post keeps its poster frame, not the video. To keep the video itself,
  save it as an asset first (`references/extraction.md`), then bookmark the
  post: the save links the two.
- Assets saved with a `pbs.twimg.com` image URL as `sourceUrl` cannot be traced
  back to a post. Save with the permalink.
