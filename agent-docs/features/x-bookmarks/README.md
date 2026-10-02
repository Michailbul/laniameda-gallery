# X post bookmarks

Last updated: 2026-10-02

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

## UI

- Main grid: bookmark assets render as post cards
  (`components/gallery/bookmark-post-card.tsx`) — author, text, media,
  date, counts, note, collection badges — laid out by
  `lib/bookmarks.ts` `bookmarkCardLayout`.
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

`tests/bookmarks.test.ts`, `tests/extension-x-adapter.test.ts`,
`tests/extension-x-post-route.test.ts`.

## Not done yet

- Only the first photo becomes a gallery image; the rest stay as media URLs
  on the bookmark.
- No mobile nav entry for the Bookmarks view (Storybooks has none either).
