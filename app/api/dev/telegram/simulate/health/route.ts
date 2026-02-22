import { NextResponse } from "next/server";
import { isDevTelegramSimEnabled, isDevTelegramSimRequestAllowed } from "@/lib/dev-telegram-sim";
import { createLogger, createRequestId } from "@/lib/observability/logger";

export const runtime = "nodejs";

const logger = createLogger({ service: "next-api-dev-telegram-sim" });

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
};

export async function GET(request: Request) {
  const requestId = createRequestId();
  const enabled = isDevTelegramSimEnabled();
  const allowed = isDevTelegramSimRequestAllowed(request);
  const bypassEnabled = parseBoolean(process.env.DEV_TELEGRAM_SIM_AUTH_BYPASS, true);

  logger.info(
    {
      requestId,
      enabled,
      allowed,
      bypassEnabled,
      phase: "dev_telegram_sim_health",
    },
    "dev_telegram_sim_health_checked",
  );

  return NextResponse.json({
    ok: true,
    requestId,
    enabled,
    allowed,
    bypassEnabled,
    envProfile: process.env.APP_ENV_PROFILE || process.env.NODE_ENV || "development",
  });
}
