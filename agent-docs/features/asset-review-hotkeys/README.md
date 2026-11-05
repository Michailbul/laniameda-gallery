# Asset review hotkeys

Owner gallery controls apply to the hovered asset or the visible expanded frame.
Pack shortcuts follow the member on display. Shortcuts ignore text fields,
editable content, repeats, IME input and modifier combinations.

- D archives the asset in place and schedules its existing deletion cascade in
  ten minutes. Repeating D keeps the original deadline. The Archive tray lists
  pending pieces with a countdown and an accessible Restore action.
- Double-clicking an archived frame or its tray preview restores it. The callback
  is guarded by a unique archive ticket, so restoring and re-archiving is safe.
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
