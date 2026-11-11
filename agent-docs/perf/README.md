# agent-docs/perf

Speed measurements for the gallery (rule: speed is rule one, see CLAUDE.md).

- `baseline-2026-10-30.md`: the first Lighthouse mobile baseline (signed-in and signed-out).
- `report-2026-11-01.md` and `report-2026-11-01.html`: before/after for the speed thread (#110–#123),
  with the decisions and what is next. The HTML has the filmstrips.
- `lighthouse-<date>.json`: compact per-route summaries (score, FCP, LCP, TBT, CLS, bytes, app JS).
- `websocket-2026-11-01.json`: Convex frame sizes per query before and after.
- `lazy-loading-2026-11-01.json`: the measurement behind not building grid virtualisation.
- `raw/`: the full Lighthouse reports, gzipped, screenshots stripped.
- `tools/`: `lh3.sh` (3 runs per route through the signed-in Chrome on :9222), `wsframes.mjs` (Convex
  frames via CDP), `lazyprobe.mjs` (which mounted tiles downloaded), `compact.py`, `build_report.py`
  (expects its inputs in /tmp/gperf; adjust the paths to rebuild).

- `frame-keys-2026-11-11.json`: first-load bytes before and after the frame keys (#222, #228 and the
  pitch link), measured on production builds against a local backend; `tools/firstload.mjs` lists a
  route's scripts and styles per file.

Re-measure the same way before merging anything that touches `/`, `/w`, `/inbox` or `/tasks`.
