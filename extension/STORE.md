# Chrome Web Store

Save to Gallery is published on the Chrome Web Store as **Unlisted** (installable from its link only; useless without a gallery token). Every merge to `main` that raises `extension/manifest.json` → `version` is uploaded and submitted by `.github/workflows/extension-publish.yml`; after Google's review (usually hours, sometimes 1–3 days) Chrome updates every installed copy by itself (it checks about every 5 hours; `chrome://extensions` → Developer mode → Update forces it).

## One-time setup (Michael's Google account mbuloichykai@gmail.com)

1. Register as a Chrome Web Store developer at https://chrome.google.com/webstore/devconsole (one-time $5 fee).
2. New item → upload `output/save-to-gallery-<version>.zip` from `scripts/package-extension.sh origin/main`.
3. Fill the listing from the text below; visibility **Unlisted**; privacy policy https://gallery.laniameda.space/extension/privacy; submit for review.
4. The item id goes into the repo secret `CWS_EXTENSION_ID`.
5. API access for the workflow: in Google Cloud (any project) enable "Chrome Web Store API", create an OAuth client (type Desktop), get a refresh token for scope `https://www.googleapis.com/auth/chromewebstore` with that account, and save `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` as repo secrets.
6. Install from the store link in each Chrome, remove the unpacked copy, paste the token once (settings then follow through Chrome sync on the same Google account).

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
