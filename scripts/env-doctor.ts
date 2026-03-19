import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type EnvMap = Record<string, string>;
type Mode = "dev-sim" | "dev-telegram" | "prod-telegram";

const ROOT = process.cwd();
const APP_ENV = path.join(ROOT, ".env");
const APP_ENV_LOCAL = path.join(ROOT, ".env.local");
const CONVEX_ENV_LOCAL = path.join(ROOT, "convex", ".env.local");

const parseMode = (): Mode => {
  const modeIndex = process.argv.findIndex((entry) => entry === "--mode");
  const value = modeIndex >= 0 ? process.argv[modeIndex + 1] : undefined;
  if (value === "dev-sim" || value === "dev-telegram" || value === "prod-telegram") {
    return value;
  }
  return "dev-telegram";
};

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

const mode = parseMode();

const requiredBase = [
  "NEXT_PUBLIC_CONVEX_URL",
  "CONVEX_URL",
] as const;

const requiredByMode: Record<Mode, readonly string[]> = {
  "dev-sim": ["SESSION_SECRET", "DEV_TELEGRAM_SIM_ENABLED"],
  "dev-telegram": ["SESSION_SECRET", "NEXT_PUBLIC_TELEGRAM_BOT_USERNAME"],
  "prod-telegram": [
    "SESSION_SECRET",
    "NEXT_PUBLIC_TELEGRAM_BOT_USERNAME",
    "CURATION_ADMIN_SECRET",
    "CURATION_ADMIN_USER_IDS",
    "NEXT_PUBLIC_CURATION_ADMIN_USER_IDS",
  ],
};

const optionalButRecommended = ["APP_ENV_PROFILE"] as const;

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

for (const key of requiredBase) {
  if (!isPresent(process.env[key])) {
    errors.push(`Missing required env var: ${key}`);
  } else {
    checks.push(`Loaded ${key}`);
  }
}

const sessionSecret = process.env.SESSION_SECRET;
if (isPresent(sessionSecret) && sessionSecret!.trim().length < 32) {
  errors.push("SESSION_SECRET must be at least 32 characters long.");
}

const curationSecret = process.env.CURATION_ADMIN_SECRET;
if (isPresent(curationSecret) && curationSecret!.trim().length < 16) {
  warnings.push("CURATION_ADMIN_SECRET should be at least 16 characters long.");
}


for (const key of requiredByMode[mode]) {
  if (!isPresent(process.env[key])) {
    errors.push(`Missing required env var for ${mode}: ${key}`);
  } else {
    checks.push(`Loaded ${key}`);
  }
}

const hasLoginBotToken =
  isPresent(process.env.TELEGRAM_LOGIN_BOT_TOKEN) || isPresent(process.env.TELEGRAM_BOT_TOKEN);
if (mode !== "dev-sim") {
  if (!hasLoginBotToken) {
    errors.push(
      `Missing required env var for ${mode}: TELEGRAM_LOGIN_BOT_TOKEN (or legacy TELEGRAM_BOT_TOKEN)`,
    );
  } else if (isPresent(process.env.TELEGRAM_LOGIN_BOT_TOKEN)) {
    checks.push("Loaded TELEGRAM_LOGIN_BOT_TOKEN");
  } else {
    warnings.push(
      "Using legacy TELEGRAM_BOT_TOKEN for login auth. Prefer TELEGRAM_LOGIN_BOT_TOKEN.",
    );
  }
}

const hasNotifyBotToken =
  isPresent(process.env.TELEGRAM_NOTIFY_BOT_TOKEN) || isPresent(process.env.TELEGRAM_BOT_TOKEN);
if (mode === "prod-telegram") {
  if (!hasNotifyBotToken) {
    errors.push(
      "Missing required env var for prod-telegram: TELEGRAM_NOTIFY_BOT_TOKEN (or legacy TELEGRAM_BOT_TOKEN)",
    );
  } else if (isPresent(process.env.TELEGRAM_NOTIFY_BOT_TOKEN)) {
    checks.push("Loaded TELEGRAM_NOTIFY_BOT_TOKEN");
  } else {
    warnings.push(
      "Using legacy TELEGRAM_BOT_TOKEN for Convex notifications. Prefer TELEGRAM_NOTIFY_BOT_TOKEN.",
    );
  }
} else if (mode === "dev-telegram" && !hasNotifyBotToken) {
  warnings.push(
    "TELEGRAM_NOTIFY_BOT_TOKEN is not set. Ingest save confirmations to Telegram will be skipped.",
  );
}

if (mode === "dev-sim") {
  if ((process.env.DEV_TELEGRAM_SIM_ENABLED || "").trim().toLowerCase() !== "true") {
    errors.push("DEV_TELEGRAM_SIM_ENABLED must be 'true' in dev-sim mode.");
  }
} else if ((process.env.DEV_TELEGRAM_SIM_ENABLED || "").trim().toLowerCase() === "true") {
  warnings.push("DEV_TELEGRAM_SIM_ENABLED is true outside dev-sim mode.");
}

if (!isPresent(process.env.AI_GATEWAY_API_KEY)) {
  warnings.push(
    "AI_GATEWAY_API_KEY is not set. AI runs that depend on gateway models will fail without it.",
  );
} else {
  checks.push("Loaded AI_GATEWAY_API_KEY");
}

for (const key of optionalButRecommended) {
  if (!isPresent(process.env[key])) {
    warnings.push(`Recommended env var not set: ${key}`);
  }
}

if (!existsSync(CONVEX_ENV_LOCAL)) {
  warnings.push("convex/.env.local missing (recommended for local convex env parity checks).");
} else {
  if (isPresent(convexEnvLocal.TELEGRAM_NOTIFY_BOT_TOKEN)) {
    checks.push("Found convex/.env.local with TELEGRAM_NOTIFY_BOT_TOKEN");
  } else if (isPresent(convexEnvLocal.TELEGRAM_BOT_TOKEN)) {
    warnings.push(
      "convex/.env.local uses legacy TELEGRAM_BOT_TOKEN for notifications. Prefer TELEGRAM_NOTIFY_BOT_TOKEN.",
    );
  } else {
    warnings.push(
      "convex/.env.local exists but TELEGRAM_NOTIFY_BOT_TOKEN is missing (notifications will not be sent).",
    );
  }

}

console.log(`Env Doctor: ${mode}`);
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
