import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";

const ROOT = process.cwd();
const ENV_LOCAL_PATH = path.join(ROOT, ".env.local");

type Mode = "dev-sim" | "dev-telegram" | "dev-all";

const parseMode = (): Mode => {
  const modeIndex = process.argv.findIndex((entry) => entry === "--mode");
  const value = modeIndex >= 0 ? process.argv[modeIndex + 1] : undefined;
  if (value === "dev-sim" || value === "dev-telegram" || value === "dev-all") {
    return value;
  }
  return "dev-telegram";
};

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

const ensureModeEnv = (mode: Mode) => {
  upsertEnvValue(ENV_LOCAL_PATH, "APP_ENV_PROFILE", mode);
  process.env.APP_ENV_PROFILE = mode;

  const simulatorEnabled = mode === "dev-sim" ? "true" : "false";
  upsertEnvValue(ENV_LOCAL_PATH, "DEV_TELEGRAM_SIM_ENABLED", simulatorEnabled);
  process.env.DEV_TELEGRAM_SIM_ENABLED = simulatorEnabled;
};

const main = async () => {
  const mode = parseMode();
  const shouldStartConvex = mode === "dev-all";

  requireEnv("CONVEX_URL");
  requireEnv("NEXT_PUBLIC_CONVEX_URL");
  ensureModeEnv(mode);

  console.log(`Mode: ${mode}`);
  console.log(`Using app port: ${APP_PORT}`);

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

  if (children.length === 0) {
    console.log("App already running; bootstrap completed.");
    return;
  }

  const cleanExit = () => {
    for (const child of children) {
      child.kill("SIGTERM");
    }
  };

  process.on("SIGINT", cleanExit);
  process.on("SIGTERM", cleanExit);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
