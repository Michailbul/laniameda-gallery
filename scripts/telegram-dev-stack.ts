import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const NGROK_API = "http://127.0.0.1:4040/api/tunnels";
const ROOT = process.cwd();
const ENV_LOCAL_PATH = path.join(ROOT, ".env.local");

type NgrokTunnel = {
  public_url?: string;
  proto?: string;
  config?: {
    addr?: string;
  };
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
};

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
    .some(
      (line) =>
        line.includes("convex dev") && !line.includes("--once") && line.includes(ROOT),
    );
};

const syncConvexFunctionsOnce = () => {
  const sync = spawnSync("bunx", ["convex", "dev", "--once"], {
    stdio: "inherit",
  });
  if (sync.status !== 0) {
    throw new Error(
      "Convex function sync failed. Run `bunx convex dev --once` and retry.",
    );
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

const main = async () => {
  requireEnv("TELEGRAM_BOT_TOKEN");
  const webhookSecret = requireEnv("TELEGRAM_WEBHOOK_SECRET");

  const { url: ngrokUrl, process: ngrokProcess } = await ensureNgrok(APP_PORT);
  upsertEnvValue(ENV_LOCAL_PATH, "TELEGRAM_WEBHOOK_PUBLIC_URL", ngrokUrl);
  upsertEnvValue(ENV_LOCAL_PATH, "AGENT_WORKER_URL", `http://127.0.0.1:${WORKER_PORT}`);
  process.env.TELEGRAM_WEBHOOK_PUBLIC_URL = ngrokUrl;
  process.env.AGENT_WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`;

  const webhookUrl = await setTelegramWebhook({
    botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    webhookSecret,
    webhookBaseUrl: ngrokUrl,
  });

  console.log(`Using app port: ${APP_PORT}`);
  console.log(`Using worker port: ${WORKER_PORT}`);
  console.log(`Using ngrok URL: ${ngrokUrl}`);
  console.log(`Telegram webhook set: ${webhookUrl}`);

  const children: ChildProcess[] = [];
  const shouldStartConvex = process.env.START_CONVEX_DEV?.trim().toLowerCase() === "true";
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
    children.push(
      startProcess("next-dev", "bun", ["run", "dev"], { APP_PORT: `${APP_PORT}` }),
    );
  }

  if (await isPortListening(WORKER_PORT)) {
    console.log(
      `Port ${WORKER_PORT} already in use, skipping \`bun run worker:dev\`.`,
    );
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

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
    if (ngrokProcess && !ngrokProcess.killed) {
      ngrokProcess.kill("SIGTERM");
    }
    setTimeout(() => process.exit(0), 300);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const monitor = (child: ChildProcess) =>
    new Promise<number>((resolve) => {
      child.once("exit", (code) => resolve(code ?? 0));
    });

  const exitCode = await Promise.race(children.map((child) => monitor(child)));
  shutdown();
  process.exitCode = exitCode;
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
