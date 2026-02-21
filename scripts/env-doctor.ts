import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type EnvMap = Record<string, string>;

const ROOT = process.cwd();
const APP_ENV = path.join(ROOT, ".env");
const APP_ENV_LOCAL = path.join(ROOT, ".env.local");
const CONVEX_ENV_LOCAL = path.join(ROOT, "convex", ".env.local");

const parseEnvFile = (filePath: string): EnvMap => {
  if (!existsSync(filePath)) {
    return {};
  }

  const out: EnvMap = {};
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const withoutExport = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length)
      : trimmed;
    const index = withoutExport.indexOf("=");
    if (index <= 0) continue;

    const key = withoutExport.slice(0, index).trim();
    const value = withoutExport.slice(index + 1).trim();
    if (key) {
      out[key] = value;
    }
  }

  return out;
};

const isPresent = (value: string | undefined) => Boolean(value && value.trim().length > 0);

const requiredForTelegramMvp = [
  "NEXT_PUBLIC_CONVEX_URL",
  "CONVEX_URL",
  "ENABLE_AGENT_WORKER",
  "AGENT_WORKER_URL",
  "AGENT_WORKER_SHARED_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_WEBHOOK_PUBLIC_URL",
] as const;

const optionalButRecommended = [
  "NEXT_PUBLIC_WORKOS_CLIENT_ID",
  "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
  "WORKOS_CLIENT_ID",
] as const;

const appEnv = parseEnvFile(APP_ENV);
const appEnvLocal = parseEnvFile(APP_ENV_LOCAL);
const convexEnvLocal = parseEnvFile(CONVEX_ENV_LOCAL);

const errors: string[] = [];
const warnings: string[] = [];
const checks: string[] = [];

if (!existsSync(APP_ENV_LOCAL)) {
  errors.push("Missing .env.local (required local source of truth).");
} else {
  checks.push("Found .env.local");
}

if (existsSync(APP_ENV)) {
  warnings.push(".env exists. Prefer consolidating local runtime values into .env.local only.");
}

const overlapKeys = Object.keys(appEnv).filter((key) => key in appEnvLocal);
for (const key of overlapKeys) {
  if (appEnv[key] !== appEnvLocal[key]) {
    warnings.push(`Conflicting values for ${key} between .env and .env.local`);
  }
}

for (const key of requiredForTelegramMvp) {
  if (!isPresent(process.env[key])) {
    errors.push(`Missing required env var: ${key}`);
  } else {
    checks.push(`Loaded ${key}`);
  }
}

if (process.env.ENABLE_AGENT_WORKER !== "true") {
  errors.push("ENABLE_AGENT_WORKER must be 'true' for Telegram MVP sprint.");
}

const isDummyMode =
  (process.env.AGENT_DUMMY_MODE || "").trim().toLowerCase() === "true";
if (!isDummyMode) {
  if (!isPresent(process.env.AI_GATEWAY_API_KEY)) {
    errors.push(
      "Missing required env var: AI_GATEWAY_API_KEY (required when AGENT_DUMMY_MODE is not true).",
    );
  } else {
    checks.push("Loaded AI_GATEWAY_API_KEY for live worker mode");
  }
} else if (!isPresent(process.env.AI_GATEWAY_API_KEY)) {
  warnings.push(
    "AI_GATEWAY_API_KEY is not set. This is okay for AGENT_DUMMY_MODE=true, but live worker mode will fail without it.",
  );
}

for (const key of optionalButRecommended) {
  if (!isPresent(process.env[key])) {
    warnings.push(`Recommended env var not set: ${key}`);
  }
}

if (!existsSync(CONVEX_ENV_LOCAL)) {
  warnings.push("convex/.env.local missing (recommended for local convex env parity checks).");
} else if (!isPresent(convexEnvLocal.WORKOS_CLIENT_ID)) {
  warnings.push("convex/.env.local exists but WORKOS_CLIENT_ID is missing.");
} else {
  checks.push("Found convex/.env.local with WORKOS_CLIENT_ID");
}

console.log("Env Doctor: Telegram MVP");
for (const check of checks) {
  console.log(`  ✓ ${check}`);
}

if (warnings.length > 0) {
  console.log("\nWarnings:");
  for (const warning of warnings) {
    console.log(`  - ${warning}`);
  }
}

if (errors.length > 0) {
  console.log("\nErrors:");
  for (const error of errors) {
    console.log(`  - ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log("\nNo blocking env issues found.");
}
