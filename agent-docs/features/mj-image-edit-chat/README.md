# Midjourney image editing conversations

Requested 24 November 2026. Extension 0.44.0, writer bridge 1.5.0.

Michael opens a frame with Option-Z (Option-F stays), or drops a Midjourney
image into Edit image in the extension side panel. He can ask the existing
writer to create/refine a prompt, edit the draft directly, pick Seedream 5.5
(default), Krea 3, GPT Image 2.6 Flare or Nano Banana 2.1, and explicitly Run
1/2/3 takes. Editing an output preserves its run/take lineage and all earlier
results. The original remains one click away.

Conversations live in the cloud, shared by both Macs. The owner can enable
Gallery reading with a switch or an explicit current chat instruction. Denial
wins; questions and quoted suggestions do not enable it. The writer requests
actual live MCP tools through a bounded reading loop. The server checks the
thread consent each call. An authenticated, isolated gallery:read delegation
reuses existing owner routes and cannot grant write/delete scopes. External
agents can list/read/reply through native Gallery MCP. Replies refresh while
the editor is open and idle. The existing Mac/fal/Pika writer selection is
reused without provider fallback or paid image runs from chat.

Cloud changes: one owner-indexed conversation table, optional idempotency key
and index on existing quick runs, native read/reply tools, writer action and
extension routes. Bounded history fails with a clear message instead of
silently deleting earlier messages or runs. No migration of existing data.
The existing Keep/review/Fantasy flows and publication flags are preserved.

Rollout order: publish matching Convex functions/schema, publish Next routes
and MCP, then install extension 0.44.0 and writer 1.5.0 on both Macs. The
existing main-branch updaters can distribute extension/writer after release.
Keep earlier extension copies until the cloud release has been read back.
Rollback frontend/extension first; the additive table/index need not be removed.

Validation: existing model/run/thread tests; consent, structured answers,
MCP schema discovery and isolated read-only delegation tests; TypeScript,
ESLint and Python compilation; offline browser fixture for drag, chat, no
generation on chat, three-take Run and continuing from take 2. The fixture
uses mocked services and does not establish live cloud persistence or provider
generation. No paid image test has been authorized or run.

GPT 2.6 endpoint and input contract verified against fal's official API page:
https://fal.ai/models/openai/gpt-image-2.6/flare/edit/api
Its price uses the existing conservative fallback estimate until a live quote
is available; the UI labels this approximate.
