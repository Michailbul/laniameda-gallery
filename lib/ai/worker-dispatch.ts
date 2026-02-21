import type { RunDispatchPayload } from "@/lib/run-contract";
import { createWorkerSignature } from "@/lib/worker-signature";

const getWorkerConfig = () => {
  const workerUrl = process.env.AGENT_WORKER_URL;
  const sharedSecret = process.env.AGENT_WORKER_SHARED_SECRET;
  if (!workerUrl || !sharedSecret) {
    return null;
  }
  return { workerUrl: workerUrl.replace(/\/$/, ""), sharedSecret };
};

export const dispatchRunToWorker = async (payload: RunDispatchPayload) => {
  const worker = getWorkerConfig();
  if (!worker) {
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
    return {
      ok: false as const,
      error: `Worker dispatch failed (${response.status}): ${message}`,
    };
  }

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
  const worker = getWorkerConfig();
  if (!worker) {
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
};
