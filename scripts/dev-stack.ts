import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const NGROK_API = "http://127.0.0.1:4040/api/tunnels";
const ROOT = process.cwd();
const ENV_LOCAL_PATH = path.join(ROOT, ".env.local");

type Mode = "dev-sim" | "dev-telegram" | "dev-all";

type NgrokTunnel = {
  public_url?: string;
  proto?: string;
  config?: {
    addr?: string;
  };
};

const parseMode = (): Mode => {
  const modeIndex = process.argv.findIndex((entry) => entry === "--mode");
  const value = modeIndex >= 0 ? process.argv[modeIndex + 1] : undefined;
  if (value === "dev-sim" || value === "dev-telegram" || value === "dev-all") {
    return value;
  }
  return "dev-telegram";
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
};

const isPortListening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

const parsePort = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    return fallback;
  }
  return parsed;
};

const APP_PORT = parsePort(process.env.APP_PORT, 3317);
const WORKER_PORT = parsePort(process.env.WORKER_PORT, 8797);

const requireEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

const upsertEnvValue = (filePath: string, key: string, value: string) => {
  const line = `${key}=${value}`;
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${line}\n`, "utf8");
    return;
  }

  const original = readFileSync(filePath, "utf8");
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const next = pattern.test(original)
    ? original.replace(pattern, line)
    : `${original.replace(/\s*$/, "")}\n${line}\n`;
  writeFileSync(filePath, next, "utf8");
};

const getNgrokHttpsUrl = async (appPort: number): Promise<string | null> => {
  const response = await fetch(NGROK_API).catch(() => null);
  if (!response?.ok) {
    return null;
  }
  const body = (await response.json().catch(() => null)) as { tunnels?: NgrokTunnel[] } | null;
  const url =
    body?.tunnels?.find((tunnel) => {
      const addr = tunnel.config?.addr || "";
      const isTargetPort = addr.endsWith(`:${appPort}`);
      return tunnel.proto === "https" && tunnel.public_url && isTargetPort;
    })?.public_url ??
    null;
  return url;
};

const ensureNgrok = async (appPort: number) => {
  const existing = await getNgrokHttpsUrl(appPort);
  if (existing) {
    return {
      url: existing,
      process: null as ChildProcess | null,
    };
  }

  const reservedDomain = process.env.NGROK_DOMAIN?.trim();
  const args = reservedDomain
    ? ["http", "--domain", reservedDomain, `${appPort}`]
    : ["http", `${appPort}`];
  const ngrokProcess = spawn("ngrok", args, {
    stdio: "ignore",
  });

  for (let i = 0; i < 40; i += 1) {
    const url = await getNgrokHttpsUrl(appPort);
    if (url) {
      return {
        url,
        process: ngrokProcess,
      };
    }
    await wait(500);
  }

  ngrokProcess.kill("SIGTERM");
  throw new Error(`Failed to start ngrok tunnel for port ${appPort}.`);
};

const setTelegramWebhook = async ({
  botToken,
  webhookSecret,
  webhookBaseUrl,
}: {
  botToken: string;
  webhookSecret: string;
  webhookBaseUrl: string;
}) => {
  const url = `${webhookBaseUrl.replace(/\/$/, "")}/api/telegram/webhook`;
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      url,
      secret_token: webhookSecret,
      allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post"],
      drop_pending_updates: false,
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; description?: string }
    | null;

  if (!response.ok || !payload?.ok) {
    throw new Error(`Failed to set Telegram webhook: ${payload?.description || response.status}`);
  }

  return url;
};

const isCurrentProjectConvexDevRunning = () => {
  const result = spawnSync("ps", ["-axo", "command"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return false;
  }
  return result.stdout
    .split("\n")
    .some((line) => line.includes("convex dev") && !line.includes("--once") && line.includes(ROOT));
};

const syncConvexFunctionsOnce = () => {
  const sync = spawnSync("bunx", ["convex", "dev", "--once"], {
    stdio: "inherit",
  });
  if (sync.status !== 0) {
    throw new Error("Convex function sync failed. Run `bunx convex dev --once` and retry.");
  }
};

const startProcess = (
  name: string,
  cmd: string,
  args: string[],
  envOverrides?: Record<string, string>,
) => {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...envOverrides,
    },
  });
  child.on("exit", (code, signal) => {
    const suffix = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.log(`[${name}] exited with ${suffix}`);
  });
  return child;
};

const ensureModeEnv = async (mode: Mode) => {
  upsertEnvValue(ENV_LOCAL_PATH, "AGENT_WORKER_URL", `http://127.0.0.1:${WORKER_PORT}`);
  upsertEnvValue(ENV_LOCAL_PATH, "APP_ENV_PROFILE", mode);
  process.env.AGENT_WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`;
  process.env.APP_ENV_PROFILE = mode;

  if (mode === "dev-sim") {
    upsertEnvValue(ENV_LOCAL_PATH, "DEV_TELEGRAM_SIM_ENABLED", "true");
    process.env.DEV_TELEGRAM_SIM_ENABLED = "true";
    return {
      ngrokProcess: null as ChildProcess | null,
      webhookUrl: null as string | null,
      ngrokUrl: null as string | null,
    };
  }

  requireEnv("TELEGRAM_BOT_TOKEN");
  const webhookSecret = requireEnv("TELEGRAM_WEBHOOK_SECRET");

  const { url: ngrokUrl, process: ngrokProcess } = await ensureNgrok(APP_PORT);
  upsertEnvValue(ENV_LOCAL_PATH, "TELEGRAM_WEBHOOK_PUBLIC_URL", ngrokUrl);
  upsertEnvValue(ENV_LOCAL_PATH, "DEV_TELEGRAM_SIM_ENABLED", "false");
  process.env.TELEGRAM_WEBHOOK_PUBLIC_URL = ngrokUrl;
  process.env.DEV_TELEGRAM_SIM_ENABLED = "false";

  const webhookUrl = await setTelegramWebhook({
    botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    webhookSecret,
    webhookBaseUrl: ngrokUrl,
  });

  return {
    ngrokProcess,
    webhookUrl,
    ngrokUrl,
  };
};

const main = async () => {
  const mode = parseMode();
  const shouldStartConvex = mode === "dev-all";

  requireEnv("AGENT_WORKER_SHARED_SECRET");
  requireEnv("CONVEX_URL");
  requireEnv("NEXT_PUBLIC_CONVEX_URL");
  requireEnv("DAYTONA_API_KEY");
  requireEnv("DAYTONA_API_URL");
  requireEnv("DAYTONA_TARGET");

  const dummyMode = parseBoolean(process.env.AGENT_DUMMY_MODE, false);
  if (!dummyMode) {
    requireEnv("AI_GATEWAY_API_KEY");
  }

  const { ngrokProcess, webhookUrl, ngrokUrl } = await ensureModeEnv(mode);

  console.log(`Mode: ${mode}`);
  console.log(`Using app port: ${APP_PORT}`);
  console.log(`Using worker port: ${WORKER_PORT}`);
  if (ngrokUrl) {
    console.log(`Using ngrok URL: ${ngrokUrl}`);
  }
  if (webhookUrl) {
    console.log(`Telegram webhook set: ${webhookUrl}`);
  }

  const children: ChildProcess[] = [];
  if (shouldStartConvex) {
    const shouldSyncOnce = parseBoolean(process.env.CONVEX_SYNC_ON_BOOT, true);
    if (shouldSyncOnce) {
      syncConvexFunctionsOnce();
    }
    if (isCurrentProjectConvexDevRunning()) {
      console.log("Convex dev already running for this project, skipping `bunx convex dev`.");
    } else {
      children.push(startProcess("convex-dev", "bunx", ["convex", "dev"]));
    }
  }

  if (await isPortListening(APP_PORT)) {
    console.log(`Port ${APP_PORT} already in use, skipping \`bun run dev\`.`);
  } else {
    children.push(startProcess("next-dev", "bun", ["run", "dev"], { APP_PORT: `${APP_PORT}` }));
  }

  if (await isPortListening(WORKER_PORT)) {
    console.log(`Port ${WORKER_PORT} already in use, skipping \`bun run worker:dev\`.`);
  } else {
    children.push(
      startProcess("worker-dev", "bun", ["run", "worker:dev"], {
        WORKER_PORT: `${WORKER_PORT}`,
      }),
    );
  }

  if (children.length === 0) {
    console.log("App and worker already running; bootstrap completed.");
    return;
  }

  const cleanExit = () => {
    for (const child of children) {
      child.kill("SIGTERM");
    }
    if (ngrokProcess) {
      ngrokProcess.kill("SIGTERM");
    }
  };

  process.on("SIGINT", cleanExit);
  process.on("SIGTERM", cleanExit);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
