import type { RunDispatchPayload } from "@/lib/run-contract";
import { createLogger } from "@/lib/observability/logger";
import { createWorkerSignature } from "@/lib/worker-signature";

const logger = createLogger({ service: "next-api-worker-dispatch" });

const getWorkerConfig = () => {
  const workerUrl = process.env.AGENT_WORKER_URL;
  const sharedSecret = process.env.AGENT_WORKER_SHARED_SECRET;
  if (!workerUrl || !sharedSecret) {
    return null;
  }
  return { workerUrl: workerUrl.replace(/\/$/, ""), sharedSecret };
};

export const dispatchRunToWorker = async (payload: RunDispatchPayload) => {
  const dispatchLogger = logger.withContext({
    runId: payload.runId,
    source: payload.source,
    intent: payload.intent,
    userId: payload.userId,
  });
  const worker = getWorkerConfig();
  if (!worker) {
    dispatchLogger.error(
      {
        phase: "worker_dispatch_env_missing",
      },
      "worker_dispatch_env_missing",
    );
    return {
      ok: false as const,
      error: "Worker dispatch env is not configured.",
    };
  }

  const body = JSON.stringify(payload);
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const signature = createWorkerSignature({
    secret: worker.sharedSecret,
    body,
    timestamp,
  });

  const response = await fetch(`${worker.workerUrl}/v1/runs/dispatch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-signature": signature,
      "x-agent-timestamp": timestamp,
    },
    body,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "Dispatch failed.");
    dispatchLogger.error(
      {
        phase: "worker_dispatch_http_error",
        status: response.status,
        error: message,
      },
      "worker_dispatch_http_error",
    );
    return {
      ok: false as const,
      error: `Worker dispatch failed (${response.status}): ${message}`,
    };
  }

  dispatchLogger.info(
    {
      phase: "worker_dispatch_ok",
    },
    "worker_dispatch_ok",
  );

  return {
    ok: true as const,
  };
};

export const cancelRunInWorker = async ({
  runId,
  requestedBy,
}: {
  runId: string;
  requestedBy: string;
}) => {
  const cancelLogger = logger.withContext({
    runId,
    requestedBy,
  });
  const worker = getWorkerConfig();
  if (!worker) {
    cancelLogger.warn(
      {
        phase: "worker_cancel_env_missing",
      },
      "worker_cancel_env_missing",
    );
    return;
  }

  const body = JSON.stringify({ runId, requestedBy });
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const signature = createWorkerSignature({
    secret: worker.sharedSecret,
    body,
    timestamp,
  });

  await fetch(`${worker.workerUrl}/v1/runs/${runId}/cancel`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-signature": signature,
      "x-agent-timestamp": timestamp,
    },
    body,
  });
  cancelLogger.warn(
    {
      phase: "worker_cancel_dispatched",
    },
    "worker_cancel_dispatched",
  );
};
