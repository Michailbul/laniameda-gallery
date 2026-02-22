import { randomUUID } from "node:crypto";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

type LoggerContext = {
  service: string;
  envProfile: string;
  minLevel: LogLevel;
  context: LogContext;
};

export type Logger = {
  debug: (meta: LogContext, message: string) => void;
  info: (meta: LogContext, message: string) => void;
  warn: (meta: LogContext, message: string) => void;
  error: (meta: LogContext, message: string) => void;
  withContext: (context: LogContext) => Logger;
  time: <T>(
    op: string,
    fn: () => Promise<T> | T,
    meta?: LogContext,
  ) => Promise<{ result: T; durationMs: number }>;
};

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REDACTED = "[REDACTED]";
const TRUNCATED_SUFFIX = "...[truncated]";
const MAX_GENERIC_STRING_LENGTH = 512;
const MAX_TEXT_STRING_LENGTH = 240;
const MAX_DEPTH = 6;
const MAX_ARRAY_LENGTH = 50;

const REDACT_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /authorization/i,
  /api[_-]?key/i,
  /cookie/i,
  /signature/i,
];

const TEXT_KEY_PATTERNS = [
  /text/i,
  /content/i,
  /prompt/i,
  /message/i,
  /body/i,
  /input/i,
];

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const parseLogLevel = (value: string | undefined): LogLevel => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }
  return "info";
};

const shouldRedact = (keyPath: string[]) => {
  const combined = keyPath.join(".");
  return REDACT_KEY_PATTERNS.some((pattern) => pattern.test(combined));
};

const isTextLikeKey = (keyPath: string[]) => {
  const combined = keyPath.join(".");
  return TEXT_KEY_PATTERNS.some((pattern) => pattern.test(combined));
};

const truncate = (value: string, maxLength: number) => {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}${TRUNCATED_SUFFIX}`;
};

const sanitizeValue = (
  value: unknown,
  keyPath: string[],
  depth: number,
  seen: WeakSet<object>,
): unknown => {
  if (depth > MAX_DEPTH) {
    return "[MAX_DEPTH]";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (shouldRedact(keyPath)) {
    return REDACTED;
  }

  if (typeof value === "string") {
    if (isTextLikeKey(keyPath)) {
      return truncate(value, MAX_TEXT_STRING_LENGTH);
    }
    return truncate(value, MAX_GENERIC_STRING_LENGTH);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncate(value.message || "error", MAX_GENERIC_STRING_LENGTH),
      stack: truncate(value.stack || "", MAX_GENERIC_STRING_LENGTH),
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((entry, index) =>
      sanitizeValue(entry, [...keyPath, String(index)], depth + 1, seen),
    );
  }

  if (isRecord(value)) {
    if (seen.has(value)) {
      return "[CIRCULAR]";
    }
    seen.add(value);

    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = sanitizeValue(nested, [...keyPath, key], depth + 1, seen);
    }
    return out;
  }

  return String(value);
};

const sanitizeMeta = (meta: LogContext) => {
  return sanitizeValue(meta, [], 0, new WeakSet()) as LogContext;
};

const normalizeError = (meta: LogContext): LogContext => {
  const out = { ...meta };
  if (out.error instanceof Error) {
    out.error = sanitizeValue(out.error, ["error"], 0, new WeakSet());
  }
  return out;
};

const emit = (ctx: LoggerContext, level: LogLevel, meta: LogContext, message: string) => {
  if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[ctx.minLevel]) {
    return;
  }

  const payload = {
    ts: new Date().toISOString(),
    level,
    service: ctx.service,
    envProfile: ctx.envProfile,
    ...sanitizeMeta(ctx.context),
    ...sanitizeMeta(normalizeError(meta)),
    msg: message,
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
};

const createLoggerFromContext = (loggerContext: LoggerContext): Logger => {
  return {
    debug: (meta, message) => emit(loggerContext, "debug", meta, message),
    info: (meta, message) => emit(loggerContext, "info", meta, message),
    warn: (meta, message) => emit(loggerContext, "warn", meta, message),
    error: (meta, message) => emit(loggerContext, "error", meta, message),
    withContext: (context) =>
      createLoggerFromContext({
        ...loggerContext,
        context: {
          ...loggerContext.context,
          ...context,
        },
      }),
    time: async (op, fn, meta = {}) => {
      const startedAt = Date.now();
      try {
        const result = await fn();
        const durationMs = Date.now() - startedAt;
        emit(
          loggerContext,
          "debug",
          {
            ...meta,
            op,
            durationMs,
          },
          "operation_completed",
        );
        return { result, durationMs };
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        emit(
          loggerContext,
          "error",
          {
            ...meta,
            op,
            durationMs,
            error,
          },
          "operation_failed",
        );
        throw error;
      }
    },
  };
};

export const createRequestId = () => randomUUID();

export const resolveEnvProfile = () => {
  return process.env.APP_ENV_PROFILE?.trim() || process.env.NODE_ENV || "development";
};

export const createLogger = ({
  service,
  envProfile = resolveEnvProfile(),
  minLevel = parseLogLevel(process.env.LOG_LEVEL),
  context = {},
}: {
  service: string;
  envProfile?: string;
  minLevel?: LogLevel;
  context?: LogContext;
}): Logger => {
  return createLoggerFromContext({
    service,
    envProfile,
    minLevel,
    context,
  });
};
