# Midjourney Extension Save Handoff

Last updated: 2026-04-02

## Why this doc exists

This is a concise implementation handoff for adding Midjourney-specific browser-extension save behavior.

It is intentionally not a full PRD because the repo is currently on `main`, and detailed feature docs should live on the feature branch once implementation starts.

## Feature goal

When browsing Midjourney, the extension should support a custom save flow that captures:
- the selected image URL
- the Midjourney prompt text automatically
- useful source metadata from the page

The result should be saved into the existing gallery ingest flow without requiring the user to manually paste the prompt.

## Current state

Existing extension and backend pieces already cover most of the generic save path:

- [extension/content.js](/Users/michael/work/laniameda/laniameda.gallery/extension/content.js)
  Generic hover badge on images. Sends `imageUrl` and `sourceUrl` to the background worker. Prompt is currently optional and manually entered in a post-save popover.
- [extension/background.js](/Users/michael/work/laniameda/laniameda.gallery/extension/background.js)
  Sends payloads to `POST /api/extension/save`.
- [app/api/extension/save/route.ts](/Users/michael/work/laniameda/laniameda.gallery/app/api/extension/save/route.ts)
  Accepts `imageUrl`, `promptText`, `sourceUrl`, `pillar`, `modelName`, `tagNames`. Already auto-tags `midjourney` based on source host.
- [convex/ingest.ts](/Users/michael/work/laniameda/laniameda.gallery/convex/ingest.ts)
  Already persists `promptText` into the prompt table and links it to the saved asset.

There is also a separate design-reference save flow:

- [app/api/extension/design/save/route.ts](/Users/michael/work/laniameda/laniameda.gallery/app/api/extension/design/save/route.ts)
- [convex/designExtensionSaves.ts](/Users/michael/work/laniameda/laniameda.gallery/convex/designExtensionSaves.ts)

That design flow is not the primary path for Midjourney image+prompt saves unless the product intent changes toward saving Midjourney as design inspiration instead of normal gallery prompt assets.

## Recommended product decision

Use the existing generic asset ingest path for V1:
- keep Midjourney saves on `POST /api/extension/save`
- auto-fill `promptText`
- optionally auto-fill `modelName: "Midjourney"`
- rely on the existing source-host auto-tagging for `midjourney`

Do not route this through the design-extension save contract unless there is a separate requirement to store Midjourney pages inside the `designs` pillar as design references.

## Proposed implementation shape

### 1. Add a Midjourney page adapter in the content script

Extend [extension/content.js](/Users/michael/work/laniameda/laniameda.gallery/extension/content.js) with Midjourney-specific logic that:
- detects `midjourney.com`
- identifies the currently relevant image card or detail panel
- extracts prompt text from the nearest Midjourney job metadata
- sends `promptText` together with `imageUrl`

This should be implemented as an additive adapter, not a rewrite of the generic hover-save flow.

Suggested structure:
- `isMidjourneyPage()`
- `extractMidjourneyContext(targetImg)`
- `findMidjourneyPrompt(root)`
- `findMidjourneyImageUrl(root)`
- `saveMidjourneyImage(context)`

### 2. Prefer custom button placement over generic hover badge where possible

If Midjourney exposes a stable action bar or card action area, inject a custom save button there instead of relying only on the generic hover badge.

Fallback:
- if no stable Midjourney-specific mount point exists, keep the generic image badge but enrich the save payload with prompt extraction when on Midjourney

### 3. Send richer payload to the existing save route

Desired payload from [extension/background.js](/Users/michael/work/laniameda/laniameda.gallery/extension/background.js):
- `imageUrl`
- `sourceUrl`
- `promptText`
- `modelName: "Midjourney"` when source host is Midjourney
- optional extra tags if useful later

No backend contract change is required for that V1 path.

## DOM discovery requirement

The blocker is not backend support. The blocker is reliable prompt extraction from Midjourney’s live DOM.

The next implementation pass needs the actual logged-in Midjourney DOM for:
- image card state
- image detail/modal state
- the prompt text container
- any action bar where a custom save button could live

Minimum useful capture from the browser:
- `outerHTML` of the image wrapper
- `outerHTML` of the prompt wrapper
- screenshot of the relevant UI state
- if the prompt is not rendered directly in DOM, one representative XHR/fetch response carrying the job payload

## What the user needs to provide for DOM work

From a logged-in Midjourney page, collect one of these:

Preferred:

```js
copy($0.outerHTML)
```

Run that in DevTools after selecting:
- the image container
- the prompt container

If needed, also collect:

```js
copy(document.documentElement.outerHTML)
```

And if the prompt only exists in network data:
- DevTools `Network`
- copy the response JSON for the job/details request

## Likely files to change

Primary:
- [extension/content.js](/Users/michael/work/laniameda/laniameda.gallery/extension/content.js)
- [extension/background.js](/Users/michael/work/laniameda/laniameda.gallery/extension/background.js)

Possible but likely minimal:
- [extension/styles.css](/Users/michael/work/laniameda/laniameda.gallery/extension/styles.css)
- [extension/manifest.json](/Users/michael/work/laniameda/laniameda.gallery/extension/manifest.json)

Probably no change needed for V1:
- [app/api/extension/save/route.ts](/Users/michael/work/laniameda/laniameda.gallery/app/api/extension/save/route.ts)
- [convex/ingest.ts](/Users/michael/work/laniameda/laniameda.gallery/convex/ingest.ts)

## Behavioral requirements

- Saving on Midjourney should remain one-click.
- Prompt extraction should be automatic whenever the prompt can be resolved confidently.
- If prompt extraction fails, image save should still work rather than hard-failing the feature.
- The UI should make the failure mode silent or low-friction, not noisy.
- The implementation should avoid brittle selectors where possible and prefer closest-container traversal over flat global selectors.

## Suggested acceptance criteria

1. On a Midjourney page, clicking the custom save button or save badge stores the selected image.
2. The saved asset includes the Midjourney prompt automatically.
3. The save still succeeds if prompt extraction is unavailable, but logs a clear debug message in the extension console.
4. Saved records are tagged as `midjourney`.
5. The saved record appears correctly in the gallery with linked prompt text.

## Verification checklist

Required after implementation:

```bash
bun run lint
bun test
```

Recommended manual validation:
1. Start the app locally.
2. Load the unpacked extension from `extension/`.
3. Open a logged-in Midjourney page with a known prompt.
4. Save one image from grid/card view.
5. Save one image from detail/modal view.
6. Confirm both assets appear in the gallery.
7. Confirm the linked prompt text matches the Midjourney prompt.
8. Confirm fallback behavior still saves the image if prompt extraction is unavailable.

## Next step for implementation

When implementation starts, create a feature branch and move this into branch-local docs under:

`agent-docs/features/midjourney-extension-save/`

At that point, expand this concise handoff into:
- `PRD.md`
- `TICKET.md`
- `HANDOFF.md`

and treat the branch-local docs as the source of truth.
