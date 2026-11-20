# World hero rotation — 20 Nov 2026

The Dear Annete opening now takes turns through 9 layered frames (Michael's picked 3D frames from board rounds v15–v18, plus the fallen giant).

Measured on the iMac, Lighthouse mobile (performance only), `/w/dear-annete`, local production builds of `main` and this branch run alternately:

| run | main | rotation |
|---|---|---|
| 1 | 84 (LCP 4.3 s, 1,758 KiB) | 99 (LCP 1.5 s, 1,117 KiB) |
| 2 | 99 (LCP 1.5 s, 1,487 KiB) | 99 (LCP 1.5 s, 1,242 KiB) |
| 3 | 99 (LCP 1.5 s, 1,640 KiB) | 99 (LCP 1.4 s, 1,310 KiB) |

TBT 60–90 ms on both. The LCP element is the tagline on both. Bytes drop because tall screens load 900×1600 portrait crops (`p*-m.webp`) instead of 2400-wide planes.

Load rules: only the first frame loads before the page settles (3.5 s + idle on phones); the next frame mounts once the current one is in; on Save-Data, 2g/3g or reduced motion the frames turn only on a click. Frames marked `wide` are left out on tall screens.

Planes are cut by `~/AI-video-work/dear-annete-pitch/v19/hero/cut.py` (each pixel in one plane over an inpainted backplate, so a drift shows no doubled edges).
