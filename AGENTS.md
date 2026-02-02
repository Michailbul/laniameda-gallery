## use bun instead of node.js

always use bun instead of node 
use linters to avoid unused code/functions.

Always read the /agent-docs repository first where we have teh Progress, TODO, Observations files
Always approach a new task with Test Driven Developement, when starting new task from todo list.

# Project Configuration - Convex AI Stack

## 🚨 CRITICAL RULES
- **Always define return validators** for all Convex functions (queries, mutations, actions)
- **Never run `npx convex deploy`** unless explicitly instructed
- **Use ConvexError** for user-facing error messages, never throw raw errors
- **Make mutations idempotent** to handle retries gracefully
- **Use indexes** for all queries that filter or sort data
- **when starting clean and answering user's first message/instruciton, read the PRD.md, PROGRESS.md, TODO.md to understand the stage of the project**
- **Update TODO.md and PROGRESS.md when finished with feature and asked user to verify this feature - when user responds positive - free to mark the feature done**
- **When there is a mistake from your side, that something was forgottent or done improperly, address this in the OBSERVATION.md file.** for example, if you run tests, they were passing, but the bun dev is erroring - meaning that something is off. 

## 🎯 PROJECT CONTEXT
- **Stack**: Convex backend with TypeScript, AI SDK integration, Agents SDK from anthropic.
- **Architecture**: Real-time database with reactive queries, server-side AI processing
- **Goal**: Build a AI UGC influencer agent platform.

## Prime directive
- Keep code celan, no more then 300 Line of code.
- Always propose a quick plan before multi-file edits; then implement and verify.

## Context & repo navigation
- Start by reading: @README.md and @package.json (scripts), and @convex/schema.ts (data model).
- When unsure about conventions, search for an existing similar feature and copy the pattern (don’t invent a new architecture).

## Verification (required)
- After code changes, run the fastest available checks from @package.json (prefer lint/typecheck + targeted tests). 
- If adding a feature, add at least one automated test or a repeatable repro script/command and show its output.
- After finishing a feature, run this full verification set to catch build/test/lint errors:
  - `bun run lint`
  - `bun test`

## Convex rules
- Queries and mutations MUST NOT call external network APIs; use Convex actions for third-party calls. [web:21][web:18]
- Use actions to call external services, then store results via a mutation (actions can orchestrate; mutations enforce invariants). [web:18]
- Choose action runtime intentionally: default Convex environment supports `fetch`; 
- Use `ctx.runQuery` / `ctx.runMutation` sparingly inside queries/mutations; prefer plain TS helper functions when possible. [web:11]

## TypeScript & schema conventions (Convex)
- Prefer validators for args (`v.*`) so argument types are inferred automatically. [page:1]
- Use schema-backed types on server and client:
  - `Doc<"table">`, `Id<"table">` from `./_generated/dataModel`. [page:1]
  - `QueryCtx`, `MutationCtx`, `ActionCtx` from `./_generated/server` for helper functions. [page:1]
- Use `Infer<typeof validator>` to share types between schema/args/helpers. [page:1]
- When inserting/updating docs, prefer `WithoutSystemFields<Doc<"table">>` helpers to avoid `_id` / `_creationTime`. [page:1]
 - After the core set, add:
      - If Convex schema/functions changed, run: npx convex dev (once) and bun convex run functions/<function> for a targeted
        sanity check.
      - If schema changed, run: npx convex push only when explicitly instructed

## Vercel AI SDK conventions
- Use Vercel AI SDK Core to generate/stream text and to define tools with schema-validated inputs. [web:17]
- For tool calling, define tools with clear descriptions and a strict input schema; return structured results. [web:17]
- If streaming tool calls, handle tool-call events and tool-result events explicitly in the server route. [web:16]

## Output expectations (how Claude should respond)
- For any task: (1) restate goal + constraints, (2) list files to touch, (3) implement, (4) show how to verify. [page:2]
- If something is ambiguous, ask 1–3 targeted questions before coding.

## Safety
- Never commit secrets; if you need env vars, document names and where they are used (don’t paste values).
## 🔧 DEVELOPMENT PATTERNS

### Convex Function Organization
- Organize functions by domain: `users.ts`, `tasks.ts`, `agents.ts`, `messages.ts`
- Use named exports for all functions
- Keep functions in `convex/` directory with `.ts` extension
- Use internal functions for sensitive operations

## 📋 COMMON COMMANDS
- npx convex dev - Start local Convex dev environment

- npx convex push - Push schema and functions to production

- bun run typecheck - Run TypeScript type checking

- Test single function: bun convex run functions/myFunction

- Create worktrees for parallel work (branches live under .worktrees/):
  - `scripts/worktree-create.sh --copy-env --install palette-hazard palette-acid palette-brass`
  - Optional: `--convex-dev` to run `bunx convex dev` in each worktree (requires network)
  - `git worktree list` to view all worktrees
  - `cd .worktrees/<branch>` to work inside a specific branch
- Remove worktrees:
  - `scripts/worktree-remove.sh .worktrees/palette-hazard`
  - `scripts/worktree-remove.sh --branch .worktrees/palette-hazard`


## Documentation

- When working with convex and specific convex feature, rely on using convex skills 
- when working with AI SDK rely on using AI sdk skill.
