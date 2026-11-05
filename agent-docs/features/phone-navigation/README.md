# Phone navigation and tap targets

Branch `feat/phone-nav`, 29 Oct 2026. From the UX audit of the same night,
findings F2, F3 and F4: under 768 px the sidebar renders at 0×0, so worlds,
shelves, Storybooks, Stories, Skills, YouTube, Motion and Cinematography could
not be reached; the bottom bar's Search tab did nothing; the toolbar's
"Exclude" buttons were 10×10 px, the other chips 23–27 px, and the rows ran
off the right edge with no hint.

## What ships

- `components/gallery/mobile-browse-sheet.tsx`: the Search tab opens a bottom
  sheet (same sheet language as the Profile sheet: handle, paper gradient,
  Geist uppercase rows, mono counts, coral for the current place). The search
  box is focused on open; under it Everything, then **Worlds** with their
  shelves grouped as the sidebar groups them (Styles, Places, Cast …), then
  **Collections**, then the **Sections**: Storybooks, Stories, Moodboards,
  Skills, YouTube, Motion, Cinematography, Tasks, Decisions (with their
  waiting counts). Every row is 44–56 px tall. Typing narrows worlds, shelves
  and sections together; Enter or the top row runs the vault's piece search
  with the typed text. A tap goes there through `applyLocation`, so the
  address bar follows (see `agent-docs/features/url-state`).
- `lib/mobile-browse.ts` builds the tree and filters the sections; tested in
  `tests/mobile-browse.test.ts`.
- `components/mobile-bottom-nav.tsx`: the Search tab carries `aria-label`,
  `aria-expanded` and lights up while the sheet is open.
- Toolbar chips (`components/gallery/filter-bar.tsx`, `filter-presets.tsx`,
  `app/globals.css`): every chip rail is `.lm-chip-rail` with `useChipRail`,
  which measures the rail and sets `data-fade` so the edge with more chips
  behind it fades out (desktop too, for the VIEWS row). On phones every
  toolbar chip is at least 40 px tall with 14 px side padding and 11 px type;
  PUBLIC/MINE 40 px. The 10 px minus is hidden on phones: **holding a menu
  chip for half a second excludes it** (and releases it again); the tap that
  ends the hold does not select. Mouse users keep the hover minus.
- The storybook shelf's header buttons (`See all →`, `New`) no longer wrap.

## Not in this branch

- Collapsing the three toolbar rows into Filters and Views popovers (F7) and
  moving PUBLISH ALL under Manage (F5) are separate work.
