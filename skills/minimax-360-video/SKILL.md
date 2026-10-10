---
name: minimax-360-video
description: >-
  Make 360° equirectangular VIDEO with MiniMax H3 plus the rehan-fal 360 LoRA,
  run on fal. A full sphere with native audio that plays as look-around video in
  Quest, DeoVR, Skybox and YouTube 360. Use for any 360 video, moving panorama,
  VR background clip, animated LED-wall plate, living skybox, or when connecting
  the 360 stills pipeline to motion. Triggers: "360 video", "moving 360",
  "equirectangular video", "MiniMax 360", "H3 360", "animated plate", "VR clip",
  "living skybox". Stills stay in 360-studio.
version: 0.1.0
created: 2026-10-03
source: https://x.com/wildmindai/status/2105276125677265243
---

# MiniMax H3 360 video

Saved 3 Oct 2026 from a tweet by @wildmindai (30 Sep 2026). It is a LoRA, not a new
model: `rehan-fal/minimax-h3-360-equirect-lora` on top of MiniMax H3. Michael wants to
build on it for the 360 exploring work, so treat this as a live direction, not trivia.

Companion to `360-studio` (stills, seam and pole QA, upscaling, the sphere viewer).
This skill is the motion branch.

## What it does

One H3 generation returns one equirectangular frame sequence: straight ahead in the
centre, directly behind at the left and right edges (they join), horizon across the
middle, poles stretched. H3's native audio comes with it. Squeeze 21:9 to 2:1, tag as
360, play it as a sphere.

Measured by the author (6 prompts × 6 frames): seam correlation 0.95, pole spread 0.26
(base H3: 0.55 and 0.89). Real 360 footage: 0.92 and 0.17.

## Run it on fal (confirmed)

Endpoint `minimax/h3/text-to-video/lora` is live on fal (schema checked 3 Oct 2026).
There is also `minimax/h3/reference-to-video/lora` (up to 9 image refs, 3 video refs,
3 audio refs), untested with this LoRA.

```json
{
  "prompt": "eqr360 360-degree equirectangular panorama video: the whole sphere around the viewer unwrapped into one frame, straight ahead in the centre, directly behind at the left and right edges which join seamlessly, the horizon running straight across the middle. <SCENE: ahead, sides, behind, overhead, plus sound>",
  "loras": [{"path": "https://huggingface.co/rehan-fal/minimax-h3-360-equirect-lora/resolve/main/h3-360-equirect-lora-v1.safetensors", "scale": 0.75}],
  "aspect_ratio": "21:9",
  "resolution": "768P",
  "duration": 5,
  "seed": 7,
  "prompt_expansion_mode": "disabled"
}
```

Rules that matter:

- **Direct file URL for the LoRA path.** The repo-id form loads the weights differently
  and gave a different video with the same seed.
- **Trigger `eqr360` plus the layout sentence**, then the scene. The layout sentence was
  in every training caption. Describe ahead, sides, behind, overhead and the sound.
- **Scale 0.75.** 1.0 also works.
- **21:9 always.** 4K gives 4368×1920, 2K 2912×1280.
- **Preview at 768P with the same seed and duration**, then re-run at 2K or 4K. The higher
  tiers upscale the 768P pass, so the preview shows the scene you will get.
- **5 s has the tightest seam.** 5–15 s hold geometry; long renders can darken in the last
  3 s. On a 10 s render keep the first ~7.5 s.
- Alternate weights: `h3-360-equirect-lora-v1-alt-896x384.safetensors` (trained at 5.2 s).

## Cost (no paid run without Michael's go)

fal lists `minimax/h3/text-to-video/lora` at $0.0625 per second (base tier). The author
quotes **$2.00 for a 10 s 4K clip**, about $0.20 a second. Before any run: state the tier,
per-clip cost and batch total, show the payload, wait for the yes. Previews at 768P first.

## Make it headset-ready

```bash
ffmpeg -i out.mp4 -vf "scale=4096:2048:flags=lanczos,setsar=1" -c:v libx264 -crf 16 -pix_fmt yuv420p -c:a copy tmp.mp4
python spatialmedia -i --v2 -p equirectangular tmp.mp4 out_360.mp4
```

The author's packager also softens the wrap-around seam (H3 has no wrap-around attention,
so the two edges can disagree) and crossfades the first second under the end for a loop.
Not published as a standalone tool; do it with ffmpeg or the Studio's Seamfix.

## Known limits

- Faint seam directly behind the viewer on busy scenes. Blend it.
- Training footage was handheld and first-person: people close to camera and a slightly
  high horizon can show up. Say "empty" places in the prompt when you want none.
- Monoscopic. Sibling LoRA for stereo: `rehan-fal/minimax-h3-vr180-sbs-lora` (VR180).
- Licence: MiniMax Community License (check before commercial work).
- Resolution is thin on a sphere: 4K is about 11 px per degree packaged at 4096×2048.
  Not LED-wall grade without upscaling.

## How it connects to 360 exploring (first pass, untested)

1. **Living plate.** Take a plate that already passed QA in `360-studio`, describe it in the
   layout-sentence format, generate a 5 s loop. Stills can't do wind, water, neon flicker.
2. **Scene scouting.** 768P previews at $0.0625/s are cheap ways to explore a world before
   committing a still. Use the world's `references/worlds.md` look words in the scene part.
3. **Audio for free.** The ambient track comes with the sphere.
4. **Viewer.** Load the result in the sphere viewer (`fantasy-360-viewer` MCP,
   `viewer_load_file`) and run `viewer_qa` for seam and pole numbers.
5. **Open question: image-to-360-video.** The text endpoint has no first-frame input.
   `reference-to-video/lora` takes image refs and might carry a plate's look. This is the
   experiment worth running first, because it would link the stills pipeline to video.
6. **Open question: does it hold a stylised world** (DADDY ISSUES painted frames, DEAR
   ANNETE), or only photoreal footage like its training set? Test before promising.

## Process

1. Write the prompt (layout sentence + scene). Show it to Michael only if he'll run it himself.
2. Quote the cost, get the go, run 768P at seed 7.
3. Look at the preview in the sphere viewer. Re-run at 2K/4K only if the geometry holds.
4. Package, tag as 360, save the keeper into the gallery (`laniameda-gallery` skill:
   `sourceUrl`, `agentDescription`, tags `animation` if painted, `model` tag `minimax-h3`).
