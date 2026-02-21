# Telegram Agent Integration — Diagrams

Last updated: 2026-02-16

Purpose: editable Mermaid diagrams that explain runtime flow and system structure for product and engineering planning.

## 1) System Structure (Logical Components)
```mermaid
flowchart LR
  U["Telegram User"] --> TG["Telegram Platform"]
  TG --> GW["Telegram Gateway<br/>Webhook/Poll Ingress"]
  GW --> CV["Convex<br/>runs / run_events / run_artifacts"]
  GW --> WD["Worker Dispatch API<br/>(HMAC signed)"]
  WD --> WK["Agent Worker"]
  WK --> SB["Sandbox Workspace<br/>media/inbound/*"]
  WK --> AX["Anthropic Agent SDK Runtime"]
  AX --> WK
  WK --> CV
  WK --> TG
  FE["Web App (Next.js)"] --> CV
```

## 2) End-to-End Telegram Message Flow
```mermaid
sequenceDiagram
  participant User as Telegram User
  participant Tel as Telegram
  participant Gw as Telegram Gateway
  participant Cx as Convex
  participant Wr as Agent Worker
  participant Sbx as Sandbox
  participant Ag as Agent SDK

  User->>Tel: Send text/media/link/document
  Tel->>Gw: Webhook update
  Gw->>Gw: Normalize inbound envelope
  Gw->>Gw: Download + validate media
  Gw->>Cx: createRun(source=telegram, runtime=agent_worker)
  Gw->>Wr: /v1/runs/dispatch (signed)
  Wr->>Cx: claimRun + setRunRunning
  Wr->>Sbx: Stage media into workspace
  Wr->>Ag: query(prompt + media note, {cwd, sandbox, tools})
  Ag-->>Wr: Stream events
  Wr->>Cx: appendRunEvent (realtime)
  Wr->>Cx: completeRun/failRun/cancelRun
  Wr->>Tel: Send final reply/media
  Tel-->>User: Bot response
```

## 3) Media Staging and Access Flow
```mermaid
flowchart TD
  A["Inbound Telegram attachment"] --> B["Download to temp"]
  B --> C["Validate size, MIME, extension"]
  C -->|invalid| X["Reject + log run_events:error/system"]
  C -->|valid| D["Copy to sandbox workspace<br/>media/inbound/<messageId>/<safeFilename>"]
  D --> E["Rewrite attachment references to staged paths"]
  E --> F["Inject media note into agent prompt"]
  F --> G["Agent SDK tools read staged files<br/>(Read/Glob/Grep/Bash as allowed)"]
```

## 4) Run Lifecycle State Machine
```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> claimed: worker claims run
  claimed --> running: worker starts execution
  running --> waiting_input: optional (approval/input needed)
  waiting_input --> running: resume
  running --> completed: success + artifacts saved
  running --> failed: terminal error
  running --> canceled: user/system cancellation
  waiting_input --> canceled: canceled while waiting
  completed --> [*]
  failed --> [*]
  canceled --> [*]
```

## 5) Deployment Topology (Prototype vs Production)
```mermaid
flowchart LR
  subgraph Prototype
    N1["Next.js App (API + UI)"] --> C1["Convex"]
    N1 --> W1["Agent Worker"]
    N1 --> T1["Telegram Webhook Route"]
  end

  subgraph Production
    UI["Next.js UI/API"] --> C2["Convex"]
    TGW["Dedicated Telegram Gateway"] --> C2
    TGW --> W2["Agent Worker"]
    W2 --> C2
  end
```

## 6) Data Contract Map (Run-Centric)
```mermaid
flowchart TB
  R["runs<br/>status/runtime/source/input"] --> E["run_events<br/>seq/type/payload"]
  R --> A["run_artifacts<br/>kind/mime/content/storageId"]
  IN["runs.input (telegram envelope)<br/>chatId/threadId/messageId/text/media[]"] --> R
  E --> TL["Timeline UI + Debugging"]
  A --> OUT["Final outputs in app/telegram"]
```

## 7) Editing Guidance
- Keep diagram nodes aligned with real code boundaries in:
  - `agent-worker/*`
  - `app/api/ai/*`
  - `convex/runs.ts`
- Update diagrams whenever run contracts/statuses or transport boundaries change.
- Prefer editing these Mermaid sources over static image exports.
