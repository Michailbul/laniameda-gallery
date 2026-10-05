# Automatic YouTube research · 5 October 2026

Michael wants the existing Gallery YouTube section to be the research dashboard,
focused on 2D animation, proven title/thumbnail packaging, video structure,
opening hooks and niche bends. Reuse the current layout, tokens and controls.

The recurring agent runs in the Explainers chat, following its existing
`niche-bending-youtube-analyzer` and `video-idea-proposals` skills and
`references/automatic-research.md`. It uses the Gallery MCP to query, save and
read back references; sources, frames and proposals live in `videoRefs`. Daily
at 09:00 Europe/Prague by default, quiet when unchanged. vidIQ is separately
registered and authorized for Codex; check real tool access on each run.

No new tables, backend calls or parallel dashboard. Source analysis remains in
its existing fields. Versioned private proposal JSON lives in `bendIdea`, under
the existing 4000-character limit. Source opening observations remain in `hook`;
our opening is three explicit proposed beats in `first30`. Public views do not
establish CTR or retention. Demand and saturation have separate linked thumbnail
evidence, with a separate external-interest reading.

The server checks the Telegram owner session before including private ideas,
likes or notes. Shared YouTube-password visitors continue seeing references.
The owner gets a Proposals filter in the existing toolbar and sees the proposal
on the source's existing detail page. Plain-text older bends still display.

Checks: lint, full Bun tests, TypeScript, production build, then owner/visitor
runtime checks and a real MCP save/readback. UI and scheduled-run success must
be reported separately. Preserve existing source checkouts and unsaved keeps.
