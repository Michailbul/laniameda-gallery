# Chrome Web Store

Save to Gallery is published on the Chrome Web Store as **Unlisted** (installable from its link only; useless without a gallery token). Every merge to `main` that raises `extension/manifest.json` → `version` is uploaded and submitted by `.github/workflows/extension-publish.yml`; after Google's review (usually hours, sometimes 1–3 days) Chrome updates every installed copy by itself (it checks about every 5 hours; `chrome://extensions` → Developer mode → Update forces it).

## Where it lives (set up 9 Nov 2026)

- Item `nlhmjpghlanlanpapgigmacjbnjoancb`, publisher mbuloichykai@gmail.com (`7d243133-8afe-4b3f-83ca-3fffc5910bbe`), visibility Unlisted, submitted for its first review on 9 Nov 2026 (0.27.1).
- Store link (works once approved): https://chromewebstore.google.com/detail/nlhmjpghlanlanpapgigmacjbnjoancb
- Publishing: `.github/workflows/extension-publish.yml` with service account `cws-publisher@laniameda-review.iam.gserviceaccount.com` (Google Cloud project laniameda-review, Chrome Web Store API on). Repo secrets `CWS_SERVICE_ACCOUNT_JSON`, `CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID`. The key is also at `~/.config/laniameda/cws/cws-publisher.json` on the MacBook (owner-only).
- Raise `version` in manifest.json in every extension PR; the merge publishes it. While a version is still in review, an upload is refused; the next bump goes through.

## Listing

**Name:** Save to Gallery
**Summary (132 max):** Save images, prompts and posts into your laniameda gallery, and send queued Midjourney prompts from the side panel.
**Category:** Productivity → Tools
**Description:**

Save to Gallery is the companion of laniameda.gallery, a private vault for generated stills, references and prompts. It needs a personal gallery token.

- Save the image or video under your pointer, with its prompt and settings, into a gallery collection or world.
- On Midjourney: a dock for moodboards, profiles and presets, quick edits, and the prompt queue. Agents queue prompts in the gallery; you inject and send each one yourself, one click per job.
- Bookmark X posts with their text and media.
- Drop local files and folders into the gallery from the side panel.

Nothing is sent anywhere except your own gallery.

**Single purpose:** Save web media and its generation details into the user's laniameda gallery, and send the user's queued Midjourney prompts from that gallery.

## Permission justifications

- **storage:** keeps the gallery address, the token and save and dock settings.
- **activeTab / scripting:** reads the image, prompt and page details of the item the user chooses to save on the current tab.
- **contextMenus:** the right-click "Save to Gallery" entries.
- **sidePanel:** the upload desk and the Midjourney queue live in the side panel.
- **Host permission `<all_urls>`:** the user saves media from any site they browse (references come from everywhere), and the content scripts add the save control and read prompt metadata on Midjourney, X, Pinterest, Krea, Higgsfield and ShotDeck. Data is sent only to the user's gallery.
- **Remote code:** none. All scripts are in the package.

## Data disclosure (privacy tab)

Collects: website content (the media, prompt and page address of items the user saves). Not sold, not used for anything but the extension's purpose, not used for creditworthiness. Sent only to gallery.laniameda.space over HTTPS.
