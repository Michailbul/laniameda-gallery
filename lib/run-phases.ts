export const RUN_EVENT_PHASES = {
  streamInit: "stream_init",
  streamChunk: "stream_chunk",
  toolProgress: "tool_progress",
  mediaStageFailed: "media_stage_failed",
  sandboxAgentStarted: "sandbox_agent_started",
  sandboxAgentFinished: "sandbox_agent_finished",
} as const;

export type RunEventPhase = (typeof RUN_EVENT_PHASES)[keyof typeof RUN_EVENT_PHASES];
