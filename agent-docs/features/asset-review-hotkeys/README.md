# Asset review hotkeys

Owner gallery controls apply to the hovered asset or the visible expanded frame.
Pack shortcuts follow the member on display. Shortcuts ignore text fields,
editable content, repeats, IME input and modifier combinations.

- D archives the asset in place and schedules its existing deletion cascade in
  ten minutes. The frame stays in the grid, grayed, with a chip showing the
  countdown and RESTORE. D on an archived frame restores it. The Archive tray
  (the dock's Archive button) lists pending pieces with a countdown and Restore.
- Double-clicking an archived frame or its tray preview restores it. The callback
  is guarded by a unique archive ticket, so restoring and re-archiving is safe.
- The key hints live in the bottom dock and in the expanded view's header.
  F stays free for feature/unfeature.
- C opens a private asset comment. V opens a scene or beat idea. Comments use the native
  asset-comment system and create agent Tasks. Scene ideas save native Stories
  linked to the current asset with `agent-review` and `scene-note` tags.
  Cmd/Ctrl+Enter saves; Escape cancels. Focus stays in the editor while open.
- Agent routines read pending review Stories and acknowledge them by removing
  `agent-review` with the existing revision guard. Text and links stay intact.

The timer runs on Convex and survives reloads, navigation and closed browsers.
No asset or publication fields change until the scheduled deletion executes.
Archive and notes require signed owner auth; cross-owner operations reject.

## Validation

Four backend tests cover timing, repeat requests, restoration races, idempotent
callbacks and ownership. Browser checks with isolated data cover D, double-click,
C/V persistence, typing/modifier guards, tray restore, expanded pack-member
selection and Escape. Production build and type check passed. Changed files
pass lint. The repository's existing test suite and full lint have unrelated
failures; the base commit reproduces the test failures.

Publication requires the additive `assetArchive` schema/functions on the canonical
cloud backend before deploying the frontend. Never publish the unrelated working
changes already present in the shared checkout.

## F: feature (5 Nov 2026)

- F toggles the curator star (`assets.setAssetStarred`) on the hovered frame
  in the vault and on the public world page (`?public=1` for the signed-in
  owner). The card repaints before the server answers; the override clears
  when the mutation resolves. Featured pieces lead the world page.
- Every asset hotkey is declared once in `lib/asset-hotkeys.ts` with the shared
  typing guard. Keys taken elsewhere: ` (Feedback), 1–9 and F inside the
  Decisions screen, E/C/0 in the inbox zoom viewer, S in the world doc editor.
- On the world page D archives through the same `assetReview.archive` and the
  frame greys out in place; double-click restores. Keypress-to-paint times are
  recorded in `window.__worldPageKeyMs`.
