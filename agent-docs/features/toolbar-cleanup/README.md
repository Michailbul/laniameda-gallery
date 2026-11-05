# One-row toolbar, Publish All behind a count, thumbnails with srcset

Branch `feat/toolbar-publish-srcset`, 29–30 Oct 2026. From the UX audit of
29 Oct, findings F5, F7, F8 and F17: the gallery view stacked three toolbar
rows (scope and sort; sixteen menu chips with an EDIT; twenty-two VIEWS chips
with a SKILLS toggle and a second EDIT) and rendered the desktop and the phone
variant both; "PUBLISH ALL (N)" sat over every grid with N the number of
loaded cards (the same world read 44, 31 and 46); grid tiles fetched one
rendition with no `srcset`.

## What ships

- `components/gallery/filter-bar.tsx`: **one row**. PUBLIC / MINE where it
  was, then **FILTERS** (a popover: Image · Video · Liked · Flatten, the menu
  chips with include and exclude, Bookmarks, Clear), **VIEWS** (a popover
  listing the saved views, the Skills switch and "save the filters that are
  on as…"; the button names the active view), the sort pills, SIMILAR, the
  tile-size slider (wide screens), the grid / collections / skills switch and
  **MANAGE** (a menu: "Edit filter chips" opens the chip editor under the
  row; "Publish all private in this view…" opens the confirmation). Nothing
  appears twice and there is one toolbar in the DOM. The row is a
  `.lm-chip-rail`: on a phone it scrolls sideways with the edge fade from
  PR #87, and the popovers become sheets above the bottom bar
  (`.lm-toolbar-popover` in `globals.css`). A popover stays open while chips
  are toggled; outside click, Esc or its button closes it.
- `components/gallery/filter-presets.tsx` is now the `ViewsPanel` (and
  `useSavedViews`, `activeViewName`); the standalone VIEWS row is gone.
- **Publish all** (`components/gallery/publish-all-dialog.tsx`,
  `lib/publish-all.ts`, `assets.countPrivateAssetsInView`): the dialog asks
  the server how many pieces of the view are private, with the view's own
  filters (collection with descendants, chips, exclusions, kind, Liked,
  hidden collections), states that number ("Make 1,140 pieces public") and
  publishes exactly those ids, 200 per request, with a progress bar. The
  query reads one page of 800 source rows per call (folder by folder, owner
  spelling by owner spelling, or the owner's newest-first index for the
  plain grid and the tag-backed smart collections) and the dialog follows
  `continueCursor` until `isDone`, so a view of any size counts exactly; it
  gives up after 60 pages and says so. Nothing floats over the grid any more and the phone
  browsing view has no publish control at all; the result shows once as a
  line under the toolbar.
- **Tiles** (`lib/grid-image.ts`, `components/image-card.tsx`,
  `components/masonry-grid.tsx`, `lib/gallery-entries.ts`): every grid still
  is a plain `<img>` with `srcset` listing the two renditions R2 holds, the
  card thumb (WebP, fit in 1440×960) and the original, at their real widths,
  and `sizes` set to the tile's laid-out width. The first twelve tiles load
  eagerly with `fetchpriority=high`; the rest are `loading="lazy"`,
  `decoding="async"`. The detail panel keeps the original.

## Decisions

- The menu chips moved into the FILTERS popover rather than staying as a
  second row: the brief asked for one row. The popover does not close on a
  chip toggle, so multi-select stays one click per chip.
- MANAGE carries the edit, not a bare EDIT: the same menu holds Publish all,
  which is management of the view, not editing.
- R2 holds no 480/960 variants, so the srcset cannot offer the browser a
  smaller file than the card thumb. Encoding those is a backend change
  (`convex/thumbnails.ts`, a backfill over every asset) and is not in this
  branch; the `srcset` and `sizes` are in place for it.
- `countPrivateAssetsInView` returns the ids with the count so the dialog
  publishes what it counted, not what the grid had loaded. It is paged
  because a world like DEAR ANNETE — ART DECO is a smart collection (its
  grid is a tag predicate over the whole vault): a single capped scan
  reported "more than 396" on the first live run.

## Tests

`tests/publish-all.test.ts` (the count query over the mock Convex context:
world with descendants, shelf, chips, exclusions, kind, other owners; the
200-id batching; the dialog copy; partial failure) and
`tests/grid-image.test.ts` (srcset order and omission rules, `sizes`, the
renditions on gallery entries).
