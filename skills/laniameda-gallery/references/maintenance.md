# Maintenance: source of truth, access, deployment

## Source of truth

- **The gallery code is the truth**: `convex/schema.ts`, `convex/validators.ts`
  and the files below. This skill describes it; when they disagree, the code
  wins and the skill gets fixed in the same commit.
- **Canonical skill source:** `skills/laniameda-gallery/` in this repo
  (`~/AI-video-work/laniameda/laniameda.gallery`, also reachable as
  `~/work/laniameda/laniameda.gallery`).
- **Claude Code and Codex read it through a symlink**, so there is one copy
  and nothing to sync: `~/.agents/skills/laniameda-gallery` → the repo folder,
  with `~/.claude/skills/laniameda-gallery` and `~/.codex/skills/laniameda-gallery`
  pointing at that. Edit the repo file and every agent sees it at once.
- Other agents (openclaw, cline) take `bunx skills` copies via
  `bun run skills:install:local`. Those copies are disposable.
- `laniameda-gallery-ingest` and `laniameda-gallery-query` were merged into
  this skill on 26 Sep 2026. The old installed copies are archived in
  `~/.claude/skills-archive/2026-09-26/`.

## Read first

Before constructing payloads or changing the ingest script, read these repo files:

- `convex/schema.ts`
- `convex/validators.ts`
- `convex/ingest.ts`
- `convex/agent_ingest.ts`
- `convex/workflows.ts`
- `app/api/ingest/route.ts`

When the save targets a world, also read:

- `convex/folders.ts` — kinds, `parentFolderId` nesting rules, `setFolderShowcased`
- `lib/collection-sections.ts` — the section names and their tags
- `convex/showcase.ts` — what the public `/w/<slug>` page actually reads
- `lib/video-ingest.ts` — the browser upload path that the large-video script mirrors

For navigation behaviour: `convex/menuFilters.ts` (island-bar pills),
`lib/medium.ts` (Animation / Live action), `app/api/extension/save/route.ts`
(what the browser extension tags).

## Access paths

**MCP (preferred everywhere).** One tool surface
(`mcp/laniameda-gallery/tools.ts`), two servers: hosted at
`https://gallery.laniameda.space/api/mcp` (Streamable HTTP; OAuth sign-in, or a
gallery agent token as `Authorization: Bearer`), and a local stdio server
(`bun run mcp:gallery`) that adds `filePath`. The Next.js routes behind both
(`app/api/agent/*`) ship with the app deploy, not the Convex deploy. Run
`gallery.mjs tools` or an MCP `tools/list` for the current tool list; do not
trust a copied one.

Where each client gets it:

| Client | How |
|---|---|
| claude.ai, Claude Desktop | Custom connector, URL above, OAuth sign-in |
| Claude Code in this repo, local or cloud | `.mcp.json`: token from `~/.config/laniameda/gallery.env` on the Mac, from `LANIAMEDA_GALLERY_AGENT_TOKEN` in the cloud (see below) |
| Claude Code elsewhere on the Mac | User-scope entry in `~/.claude.json` with a `headersHelper` (see below) |
| Codex app / CLI / IDE | `config.toml`: `url` + `bearer_token_env_var` |
| Any shell with no MCP (Codex cloud, CI, another repo's cloud session) | `scripts/gallery.mjs`, or plain `curl` to `/api/mcp` |

MCP registration and credentials depend on the current agent session. Do not
assume it is unavailable from an older setup note. Discover the tools and run
`check_connection`. Michael issues tokens (`/agents`); each client has its own
so one can be revoked alone.

### Where Claude Code gets the token

On the Mac the token lives in one file, `~/.config/laniameda/gallery.env`
(`export LANIAMEDA_GALLERY_AGENT_TOKEN=…`), which `~/.zshenv` sources. A
terminal session has the variable. A session started by the Claude desktop app
has none, because the app launches Claude Code without the shell profile.
Claude Code sends an unset `${VAR}` in a header exactly as written, the gallery
answers `401 invalid_token`, and the connector shows as failed while the token
is fine.

Both Claude Code entries read the file through a `headersHelper`, so they
connect however Claude was started:

| Entry | Static header | `headersHelper` |
|---|---|---|
| Project: `.mcp.json` in this repo | `Bearer ${LANIAMEDA_GALLERY_AGENT_TOKEN}` | `sh skills/laniameda-gallery/scripts/mcp-headers.sh` |
| User: `~/.claude.json`, every other folder on the Mac | none | `~/.config/laniameda/gallery-mcp-headers.sh` |

- **Project helper** (in this repo). With `gallery.env` present it prints
  `{"Authorization": "Bearer <token>"}`, which overrides the static header.
  Without the file it prints `{}` and the static header applies: that is a
  cloud sandbox, where the variable is set and the file does not exist.
  Claude Code runs a project-scope helper from the repo root, with every
  variable whose name contains TOKEN, KEY, SECRET, AUTH or PASSWORD removed, and
  only once the folder's trust dialog has been accepted. That is why the helper
  reads the file. In an untrusted checkout the static header is all that is
  sent.
- **User helper** (outside the repo, Michael's Mac only). It uses the variable
  when set, otherwise sources `gallery.env`, and exits 1 with a message when
  neither holds a token. User-scope helpers keep their environment.

Inside this repo the project entry wins: Claude Code takes the whole entry from
the highest scope and merges nothing from the user one. The desktop app, cloud
sessions and `claude -p` load `.mcp.json` servers without asking. The
interactive CLI asks once per machine, and until that approval
`claude mcp get laniameda-gallery` run in this repo reports the user entry.
To check the project entry itself:

```bash
env -u LANIAMEDA_GALLERY_AGENT_TOKEN claude \
  --settings '{"enabledMcpjsonServers":["laniameda-gallery"]}' \
  mcp get laniameda-gallery
```

Expect `Scope: Project config` and `Status: ✔ Connected`, with the variable and
without it. To rotate the token, edit `gallery.env`: the shell and both helpers
read it on the next connection. Neither helper logs the token. Tests:
`tests/gallery-mcp-headers.test.ts`.

### Cloud sessions

A cloud sandbox has none of the laptop's config. It needs three things:

1. **The token** as an environment variable, `LANIAMEDA_GALLERY_AGENT_TOKEN`.
   In Codex cloud use a variable, not a secret: secrets are removed before the
   agent phase. The static header in `.mcp.json` carries it; the helper finds
   no `gallery.env` there and adds nothing.
2. **Network access** to `gallery.laniameda.space` (API),
   `laniameda-gallery-videos.549ed200949b388f171b696e6ea7d033.r2.cloudflarestorage.com`
   (uploads) and `pub-ad6ed85f12d147539181afa324bead00.r2.dev` (media).
3. **This skill.** Claude cloud sessions load it from the repo's
   `.claude/skills/` (a link to `skills/laniameda-gallery`) and from the skills
   enabled on claude.ai. The claude.ai copy is an upload, so it goes stale:
   after changing this folder, zip it and replace the copy in claude.ai →
   Settings → Capabilities → Skills. Bump `version` in `SKILL.md` so the two
   can be compared.

**Direct Convex scripts (Michael's machine only).** Owner-scoped via
`KB_OWNER_USER_ID`. `folderIds` works: the first is primary, the rest are
linked right after the save.

```bash
CONVEX_URL=https://perfect-buffalo-375.convex.cloud KB_OWNER_USER_ID=<owner id> \
  bun run ~/.agents/skills/laniameda-gallery/scripts/ingest.ts '<JSON>'

CONVEX_URL=https://perfect-buffalo-375.convex.cloud KB_OWNER_USER_ID=<owner id> \
  bun run ~/.agents/skills/laniameda-gallery/scripts/query.ts '<JSON>'
```

Source both values from the repo's `.env.local`; never paste the owner id into
a prompt or a wrapper script.

**Convex only trusts a signed owner.** Every owner-scoped function takes the
actor from `ctx.auth` (`convex/actor.ts`), so the scripts also need
`CONVEX_AUTH_PRIVATE_KEY` from `.env.local`. `scripts/convex-auth.ts` signs a
one-hour token for `KB_OWNER_USER_ID` and sends it as `Authorization: Bearer`.
Without the key, the deployment answers `Not authenticated.`. A bare
`ownerUserId` argument is no longer enough.

## Agent descriptions: switches and backfill

Deployment env (set with `CONVEX_DEPLOYMENT=dev:perfect-buffalo-375 bunx convex env set …`):

- `AGENT_DESCRIPTIONS_ENABLED=true` turns on the automatic pass for new assets
  saved without an `agentDescription`.
- `AGENT_DESCRIPTION_MODEL` overrides the vision model (default
  `gemini-3.5-flash-lite`). `GEMINI_API_KEY` is shared with semantic search.

Backfill, all internal actions:

```bash
# count what's missing (no calls to Gemini)
CONVEX_DEPLOYMENT=dev:perfect-buffalo-375 bunx convex run agentDescriptions:backfillAgentDescriptions '{"dryRun":true}'
# describe everything missing, paced at spacingMs per call; reschedules itself page by page
CONVEX_DEPLOYMENT=dev:perfect-buffalo-375 bunx convex run agentDescriptions:backfillAgentDescriptions '{"spacingMs":1500}'
# rebuild the text lane for every asset, never touching the multimodal model
# (loop on nextCursor until done: true)
CONVEX_DEPLOYMENT=dev:perfect-buffalo-375 bunx convex run semanticIndex:backfillBatch '{"sourceType":"asset","batchSize":25,"textOnly":true}'
```

The description backfill re-indexes text only as well. **Never run a pixel-lane
backfill fast**: the multimodal embedding model allows only a few requests a
minute, and live search shares that budget. Pixel lanes that are still missing
(the ~900 assets stuck before 26 Sep) need either a quota increase for
`gemini-embedding-2` in Google Cloud, or a slow drip of `backfillBatch` without
`textOnly` at one batch of 1 every ~20 s.

## Deployment ground truth (direct-Convex path only)

One Convex deployment serves both local dev and production: `dev:perfect-buffalo-375`
at `https://perfect-buffalo-375.convex.cloud`. There is no separate prod
deployment — never pass `--prod`.

The shell commonly inherits `CONVEX_DEPLOYMENT` pointing at a *different*
project. `bunx convex run …` picks that up silently and resolves IDs against the
wrong tables, returning plausible-looking wrong data. Always prefix CLI calls:

```bash
CONVEX_DEPLOYMENT=dev:perfect-buffalo-375 bunx convex run folders:listFolders '{"ownerUserId":"<id>"}'
```

Scripts that build their own `ConvexHttpClient` should hardcode the cloud URL
rather than read `process.env.CONVEX_URL`, for the same reason. And source
secrets from the repo's `.env.local` explicitly — `export $(grep … .env.local)`
run from a scratch directory silently finds nothing and dumps the whole
environment.

## Convex auth keys and rollout

- `CONVEX_AUTH_PRIVATE_KEY`: Vercel env, the repo's `.env.local` (scripts) and
  the agent worker. `CONVEX_AUTH_JWKS`: Convex env. Generate the pair with
  `bun scripts/generate-convex-auth-keys.ts` (prints only).
- `convex/auth.config.ts` reads `CONVEX_AUTH_JWKS` at push time. Set it on the
  deployment **before** pushing, or the push fails.
- `LEGACY_OWNER_ARG_AUTH=true` (Convex env) accepts unauthenticated calls that
  name an owner, the pre-fix behaviour. It only bridges the gap between the
  Convex push and the Vercel deploy. Unset it right after.
- Rollout order: set `CONVEX_AUTH_JWKS` and `LEGACY_OWNER_ARG_AUTH=true` →
  push Convex → set `CONVEX_AUTH_PRIVATE_KEY` in Vercel and `.env.local` →
  deploy the app → check the vault loads → `bunx convex env remove
  LEGACY_OWNER_ARG_AUTH` (with the `CONVEX_DEPLOYMENT=dev:perfect-buffalo-375`
  prefix, like every CLI call).

## When the contract changes

1. Change the code.
2. Update `references/data-model.md` (and `ingest.md` / `query.md` if the
   payloads moved) in the same commit.
3. Run the skill tests: `bun test tests/gallery-skill-scripts.test.ts
   tests/gallery-skill-workflow-args.test.ts tests/gallery-ingest-video-prep.test.ts
   tests/gallery-agent-filters.test.ts tests/hybrid-search.test.ts
   tests/agent-descriptions.test.ts`, then the whole suite with `bun test`.
4. Claude Code and Codex pick it up through the symlink. Refresh the other
   agents with `bun run skills:install:local`.

**When Michael says he pushed gallery updates:** `cd
~/AI-video-work/laniameda/laniameda.gallery && git pull`. No need to ask.
