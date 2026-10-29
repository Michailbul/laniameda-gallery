# URL state: every gallery view has an address

Branch `feat/url-state`, 29 Oct 2026. From the UX audit of the same night
(finding F1): every view except `/inbox`, `/youtube` and `/tasks` lived in
client state; a refresh went back to Everything and nothing could be linked,
bookmarked or pasted by an agent. `/youtube` was the one view with a
"Copy link".

## What ships

- `lib/gallery-routes.ts`: the route model, pure and client-safe.
  `parseGalleryRoute(pathname, search)` and `galleryRoutePath(route, asset)`
  round-trip every view; `resolveWorldSegment` finds a root by world key,
  public slug or id; `collectionPageUrl` and `galleryPageUrl` build the absolute
  links the agent routes return. Tests: `tests/gallery-routes.test.ts`.
- `components/gallery/dashboard.tsx`: `currentRoute` is derived from the view
  flags (storybook or skill open, Storybooks / Moodboards / Stories / Bookmarks /
  Motion / Cinematography / Skills views, the selected collection with its
  world tab) and `currentAssetId` from the detail panel. One effect writes the
  address (`pushState` for a change the user made, `replaceState` while a
  location is being applied), one listens to `popstate`, one applies a pending
  location once the data it names has loaded (a world waits for the folders).
  `applyLocation` is the single place a URL becomes view state; the Gallery and
  Home items go through it too.
- The address is not a second store: view state stays the source of truth, so
  every existing handler keeps working and only shows in the URL.
- Pages for the new paths render `GalleryRoot` (the shell moved out of
  `app/page.tsx`). `app/w/[slug]` keeps serving the public world page to
  visitors; a signed-in owner gets the vault on that world, and `?public=1`
  shows the public page to the owner.
- `StoriesView` takes `openStoryId` / `onOpenStoryChange` so `/stories/<id>`
  opens that text and back/forward closes it; the open story is derived, not
  synced.
- "Copy link" in the breadcrumb row of any collection and in the detail panel.
- Server: `url` on `open_world`, `list_collections`, `list_moodboards`,
  `get_moodboard`, `get_story` and story saves. Skill version 1.15.1.

## Decisions

- `/w/<segment>` is the world key when the root is a marked world, else the id.
  Shelves are addressed by id: names change, ids do not.
- A world tab opened from a shelf links as `/w/<world>/<tab>`: the tab shows the
  world's documents either way.
- A storybook or Skill open over any view links as `/storybooks/<id>` or
  `/skills/<id>`; reopening shows it over its own section.
- Public scope (`PUBLIC` in the toolbar) has no address of its own; the path is
  `/` while it is on.

## Not in this branch

- Filters, sort, zoom and saved views stay in client state and localStorage.
- The Inbox, Tasks and YouTube pages keep their own routing.
