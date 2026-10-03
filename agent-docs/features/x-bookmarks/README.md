# X post bookmarks

Last updated: 2026-10-03

Save posts from x.com (and twitter.com) into the gallery as bookmarks, filed
into collections, shown as post cards.

## Flow

1. `extension/x-adapter.js` (`SaveToGalleryX`) reads each
   `article[data-testid="tweet"]`: permalink + status id, author name /
   handle / avatar / verified, text (emoji and line breaks kept), language,
   posted time, photos (as `name=orig`) and video/GIF posters, the quoted
   post, and counts from the action bar's aria-label.
2. `extension/content.js` (section "X (Twitter) post bookmarks") adds a
   **Save** button to every post's action bar. It opens a picker: collections
   (roots with their sub-collections, multi-select, "New collection"), an
   optional note, **Save bookmark**. The X picker remembers its own last
   collections (`lastXPostFolderIds`), separate from image saves.
3. `extension/background.js` `saveXPost` posts to `/api/extension/x-post`.
   Posts with media send no preview (the backend fetches the first image);
   text posts send a screenshot cropped to the post. If the media fetch fails
   server-side, it retries once with the crop.
4. `app/api/extension/x-post/route.ts` (extension token auth) →
   `convex/bookmarkSaves.ts` `saveXPostFromExtension`.

## Backend contract

- Table `bookmarks`: one row per (owner, platform, post id). Post fields are
  source metadata (`convex/validators.ts` `bookmarkPostFields`); `userNote`
  is the owner's own words.
- The preview is a normal asset: `assetRole: "bookmark"`, `pillar:
  "bookmarks"`, `bookmarkId` → the row, `sourceUrl` = permalink, ingest key
  `x-post:<id>`, tags `x` + `bookmark`. Collections, search, star, public and
  delete all work through the asset. Deleting the asset deletes the bookmark.
- Re-saving a post is idempotent: it refreshes captured fields (never blanks
  one the new capture missed, never drops the note) and adds any newly picked
  collections. No second asset.
- The post text, author, quoted post and note feed the asset's semantic
  search text lane (`bookmarkText`).
- Gallery results (`hydrateGalleryAssetResults`) carry `bookmark` for
  bookmark assets. `bookmarks:listBookmarks` lists them, optionally narrowed
  to a collection (and its sub-collections). `bookmarks:updateBookmarkNote`
  edits the note.

## Saving from a link (agents)

`convex/bookmarkSaves.ts` `saveXPostFromAgent` takes a permalink and reads the
post itself: `api.fxtwitter.com` first (counts, quote, alt text), X's embed
payload (`cdn.syndication.twimg.com/tweet-result`) second. Both are mapped to
the extension's capture shape in `convex/bookmarkHelpers.ts`, so one
normalizer and one save (`saveXPost`) serve both paths. Entry points:
`/api/agent/bookmarks` (actions `save`, `list`, `note`), the MCP tools
`save_bookmarks` / `list_bookmarks` / `set_bookmark_note`, and
`skills/laniameda-gallery/scripts/bookmarks.ts`.

- Assets whose `sourceUrl` is the post's permalink are **linked** to the post
  (`bookmarks:linkAssetsToBookmark`): `bookmarkId` set, tag `bookmark` added
  with its `assetTags` row, reindexed. They keep their `assetRole`. No preview
  asset is created.
- With nothing saved yet, the preview is the first image, the video's poster,
  or for a text post the author's avatar (the card shows the text, not the
  stored image).
- A post that cannot be read is refused unless the caller sends its text or
  media.
- Deleting the asset a bookmark points at moves the bookmark to another piece
  of the same post (`assets.by_bookmark`); the bookmark is deleted with its
  last piece.

## UI

- Main grid: bookmark assets render as post cards
  (`components/gallery/bookmark-post-card.tsx`) — author, text, media,
  date, counts, note, collection badges — laid out by
  `lib/bookmarks.ts` `bookmarkCardLayout`.
- A tile is a post card when the asset is the post's own preview
  (`assetRole: "bookmark"`). A media piece linked to its post stays a media
  tile in the main grid (`GalleryEntry.postCard`, `lib/gallery-entries.ts`).
- Island bar → **Bookmarks** pill (a `menuFilters` row on the tag `bookmark`).
  With it on, every piece of a saved post shows as that post, once per post.
- The vault's keyword search matches post text, author and note
  (`buildAssetSearchHaystack` in `dashboard.tsx`).
- Sidebar → **Bookmarks** (`components/gallery/bookmarks-view.tsx`): every
  saved post, collection chips with counts, search over text / author / note.
- Detail panel DETAILS tab leads with the post
  (`components/gallery/bookmark-detail.tsx`): full text, quoted post, all
  media, counts, "Open on X", editable note.

## Default collections

The extension creates **Cars** once per install, the first time the
collection list loads, if no root collection of that name exists
(`DEFAULT_COLLECTIONS` in `extension/background.js`). Deleting it later
does not bring it back.

## Tests

`tests/bookmarks.test.ts`, `tests/bookmarks-agent.test.ts`,
`tests/extension-x-adapter.test.ts`,
`tests/extension-x-post-route.test.ts`.

## Not done yet

- Only the first photo becomes a gallery image; the rest stay as media URLs
  on the bookmark.
- A video post keeps its poster frame, not the video.
- 44 older pieces were saved with a `pbs.twimg.com` image URL as `sourceUrl`,
  so they cannot be matched to their post.
- No mobile nav entry for the Bookmarks view (Storybooks has none either).
