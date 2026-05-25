# Codex Cinema-Inspiration Ingest — PRD

**Status:** Planned, not yet implemented
**Owner:** Michael
**Date:** 2026-05-22
**Surface:** Codex agent (laniameda-gallery-ingest skill) → `cinemaInspiration:ingestCinemaFrame`

## Goal

When the codex agent ingests a cinema frame, it should produce two things alongside the frame:

1. **A cinematographic read** — a structured description of the frame in the language of cinematography: lens, focal length, aperture, composition, lighting, color grading, implied camera movement, mood. This goes into `cinemaMetadata.agentDescription` so that a future agent could in theory recreate the shot from the description alone.
2. **An annotated overlay** — a derivative image produced by GPT Image 2 (via image-gen MCP) that paints the cinematographic notes onto a small chrome strip over the original frame. The overlay is stored as a separate cinema asset and linked back to the original via `cinemaMetadata.annotatedAssetId`.

This makes the cinema-inspiration vault a self-teaching reference library — every frame carries its own recreation recipe.

## Why

Cinema frames are the most context-dependent asset type in the gallery. A still from *Blade Runner 2049* is useless as inspiration if you can't see why it works: what lens flattened the perspective, what lit the subject, what color split is doing the emotional work. Today that knowledge dies on the user's side of the screen.

The agent should be the one who knows. Then every frame in the vault is also a lesson.

## Inputs

When codex ingests a cinema frame, it has:

- The image bytes (from a URL, screenshot, drop, etc.)
- Optional user-provided metadata: `movieTitle`, `director`, `year`, `scene`
- The codex's own vision capability — it reads the image directly

## Outputs

### Required (V1)

The codex agent calls `cinemaInspiration:ingestCinemaFrame` with **all** of these populated:

```ts
cinemaMetadata: {
  movieTitle: "...",            // user-provided, or inferred from filename/EXIF if obvious
  director?: "...",             // inferred if movieTitle is known
  year?: 2017,                  // inferred if movieTitle is known
  scene?: "...",                // user-provided or short codex inference
  cinematographer?: "...",      // inferred from director+year
  lens: "Panavision Primo 35mm",
  aperture: "T1.4 (estimated)",
  composition: "Centered vanishing point. Strong horizontal monolith band. Subject in lower-third silhouette.",
  lighting: "Single warm amber key from upper-right. Deep cool ambient fill in shadows. Practical glow from holographic surfaces.",
  cameraMovement: "Locked-off static shot.",
  colorPalette: "Amber #d97742 against teal #2e4a55 — ~92% of pixels in two-tone split.",
  mood: "Apocalyptic stillness. Industrial sublime.",
  agentDescription: "<full prose paragraph synthesizing the above into a recreation brief>",
}
```

### Required vocabulary

The codex agent must write in cinematography language, not film-criticism language. Concrete over evocative:

- ✅ "85mm equivalent, shallow depth of field, subject isolated against bokeh"
- ❌ "intimate, dreamlike, melancholic"

- ✅ "Backlit key with no fill — subject reads as silhouette against window"
- ❌ "moody lighting"

- ✅ "1.5:1 horizontal pan implied by motion blur on background"
- ❌ "dynamic camera"

The `agentDescription` is the synthesis — it can be evocative, but only after the structured fields have done the technical work.

### Stretch (V2): Annotated overlay

After the cinema frame is ingested, the codex agent calls **GPT Image 2** (via the image-gen MCP) with a prompt like:

> Take this cinema frame. Add a thin chrome strip along the bottom 12% of the image, sized to maintain the original aspect ratio above. On the strip, in JB Mono 11px white-on-black, paint these annotations: `LENS: {lens}`, `LIGHT: {lighting summary}`, `COMP: {composition summary}`, `PALETTE: {colorPalette summary}`. Keep the strip minimal — no logos, no decorative chrome, no rounded corners. The output should read as a technical reference card, not a poster.

The output bytes come back from GPT Image 2, and codex ingests the overlay as a second cinema asset:

```ts
const annotated = await client.action(api.cinemaInspiration.ingestCinemaFrame, {
  ownerUserId,
  base64: annotatedBase64,
  mimeType: "image/png",
  fileName: `${originalFileName}.annotated.png`,
  ingestSource: "agent",
  ingestKey: `${originalIngestKey}:annotated`,
  cinemaMetadata: {
    movieTitle,
    director,
    year,
    scene: `Annotated overlay of ${originalScene ?? "frame"}`,
    // Inherit cinematographic fields from the original
    lens, aperture, composition, lighting, cameraMovement, colorPalette, mood,
    agentDescription: "Annotated version. See original for full read.",
  },
});

// Then patch the original asset to link to the annotated one:
await client.mutation(api.cinemaInspiration.linkAnnotatedAsset, {
  ownerUserId,
  originalAssetId,
  annotatedAssetId: annotated.assetId,
});
```

(The `linkAnnotatedAsset` mutation is to be implemented when V2 lands.)

The `cinemaModal` UI gets a toggle between "Original" and "Annotated" when both exist.

## Out of scope (for now)

- Auto-generating cinematographic reads for **already-ingested** cinema frames (no backfill). Frames ingested manually by Michael through the drag-drop panel will have empty `agentDescription` until a future "Ask codex to enrich" button is added.
- Generating annotated overlays for non-cinema pillars (e.g. creators) — different problem.
- Style-transfer or recreation actions (e.g. "give me this shot but with a different subject") — separate feature on top of this one.

## Acceptance

V1 is done when:

- Codex agent, given a cinema frame URL or image path, ingests it via `ingestCinemaFrame` with all cinematographic fields populated, including a full `agentDescription`.
- The cinema modal in the UI renders the metadata sidebar with all fields visible (see `components/gallery/cinema-modal.tsx`).
- The skill `laniameda-gallery-ingest` documents the cinema branch (already done — see `references/ingest-examples.md` §1d).

V2 is done when:

- After V1 ingest, codex agent also generates the annotated overlay via GPT Image 2 and ingests it as a linked asset.
- The cinema modal exposes an "Original ↔ Annotated" toggle when both versions exist.
- The annotated overlay is consistent with brand chrome (linen on carbon, JB Mono 11px, no rounded corners).

## Implementation notes

- The schema already supports this: `cinemaMetadata.agentDescription` and `cinemaMetadata.annotatedAssetId` are reserved fields on the `assets` table (see `convex/validators.ts` → `cinemaMetadataValidator`).
- Image embedding runs automatically on insert — no special wiring needed for semantic search to pick up annotated overlays too.
- For V2 we'll add a small `linkAnnotatedAsset` mutation in `convex/cinemaInspiration.ts` (currently the file only has the `ingestCinemaFrame` action).
- The GPT Image 2 prompt template should live next to this PRD so we can iterate on it without touching code.
