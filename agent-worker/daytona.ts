import { Daytona, type Sandbox } from "@daytonaio/sdk";
import { workerConfig } from "./config";

const daytona = new Daytona({
  apiKey: workerConfig.daytonaApiKey,
  apiUrl: workerConfig.daytonaApiUrl,
  target: workerConfig.daytonaTarget,
  _experimental: {},
});

export const createRunSandbox = async ({
  runId,
  userId,
}: {
  runId: string;
  userId: string;
}) => {
  const label = `run-${runId}`;
  const sandbox = await daytona.create({
    language: "typescript",
    autoStopInterval: workerConfig.sandboxAutoStopMinutes,
    ephemeral: true,
    envVars: {
      RUN_ID: runId,
      RUN_USER_ID: userId,
    },
    labels: {
      app: "prompt-storager",
      role: "agent-run",
      runId,
      userId,
      worker: workerConfig.workerId,
    },
  });

  return {
    sandbox,
    sandboxLabel: label,
  };
};

export const safeDeleteSandbox = async (sandbox: Sandbox | null | undefined) => {
  if (!sandbox) return;
  try {
    await sandbox.delete();
  } catch (error) {
    console.error("Failed to delete sandbox:", error);
  }
};
