import { beforeEach, describe, expect, mock, test } from "bun:test";

type ParsedPayload = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

const state = {
  parseResult: null as ParsedPayload | null,
  verifyResult: true,
  freshResult: true,
  parseCalls: [] as unknown[],
  verifyCalls: [] as Array<{ data: ParsedPayload; botToken: string }>,
  freshCalls: [] as Array<{ authDate: number; maxAge: number | undefined }>,
  createSessionCookieCalls: [] as Array<Record<string, unknown>>,
};

const routePath = new URL("../app/api/auth/telegram/route.ts", import.meta.url).pathname;

mock.module("@/lib/telegram-auth", () => ({
  parseTelegramWidgetData: (input: unknown) => {
    state.parseCalls.push(input);
    return state.parseResult;
  },
  verifyTelegramAuth: (data: ParsedPayload, botToken: string) => {
    state.verifyCalls.push({ data, botToken });
    return state.verifyResult;
  },
  isAuthDateFresh: (authDate: number, maxAge?: number) => {
    state.freshCalls.push({ authDate, maxAge });
    return state.freshResult;
  },
  createSessionCookie: async (user: Record<string, unknown>) => {
    state.createSessionCookieCalls.push(user);
  },
}));

describe("POST /api/auth/telegram", () => {
  beforeEach(() => {
    state.parseResult = {
      id: 278674008,
      first_name: "Michael",
      last_name: "Dev",
      username: "laniameda",
      photo_url: "https://example.com/avatar.jpg",
      auth_date: 1_710_000_000,
      hash: "a".repeat(64),
    };
    state.verifyResult = true;
    state.freshResult = true;
    state.parseCalls = [];
    state.verifyCalls = [];
    state.freshCalls = [];
    state.createSessionCookieCalls = [];
    process.env.TELEGRAM_LOGIN_BOT_TOKEN = "123456:login_bot_token";
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  test("returns 400 for invalid JSON", async () => {
    const { POST } = await import(routePath);

    const response = await POST(
      new Request("http://localhost/api/auth/telegram", {
        method: "POST",
        body: "{",
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    expect(state.parseCalls.length).toBe(0);
  });

  test("returns 400 for invalid Telegram payload", async () => {
    state.parseResult = null;
    const { POST } = await import(routePath);

    const response = await POST(
      new Request("http://localhost/api/auth/telegram", {
        method: "POST",
        body: JSON.stringify({ foo: "bar" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    expect(state.verifyCalls.length).toBe(0);
    expect(state.createSessionCookieCalls.length).toBe(0);
  });

  test("returns 500 when login bot token env vars are missing", async () => {
    delete process.env.TELEGRAM_LOGIN_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    const { POST } = await import(routePath);

    const response = await POST(
      new Request("http://localhost/api/auth/telegram", {
        method: "POST",
        body: JSON.stringify({ any: "payload" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(500);
    expect(state.verifyCalls.length).toBe(0);
  });

  test("uses legacy TELEGRAM_BOT_TOKEN fallback when TELEGRAM_LOGIN_BOT_TOKEN is missing", async () => {
    delete process.env.TELEGRAM_LOGIN_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = "123456:legacy_token";
    const { POST } = await import(routePath);

    const response = await POST(
      new Request("http://localhost/api/auth/telegram", {
        method: "POST",
        body: JSON.stringify({ any: "payload" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(state.verifyCalls.length).toBe(1);
    expect(state.verifyCalls[0]?.botToken).toBe("123456:legacy_token");
  });

  test("returns 401 when hash is invalid", async () => {
    state.verifyResult = false;
    const { POST } = await import(routePath);

    const response = await POST(
      new Request("http://localhost/api/auth/telegram", {
        method: "POST",
        body: JSON.stringify({ any: "payload" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(401);
    expect(state.createSessionCookieCalls.length).toBe(0);
  });

  test("returns 401 when auth_date is stale", async () => {
    state.freshResult = false;
    const { POST } = await import(routePath);

    const response = await POST(
      new Request("http://localhost/api/auth/telegram", {
        method: "POST",
        body: JSON.stringify({ any: "payload" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(401);
    expect(state.createSessionCookieCalls.length).toBe(0);
  });

  test("creates session and returns normalized user for valid auth payload", async () => {
    const { POST } = await import(routePath);

    const response = await POST(
      new Request("http://localhost/api/auth/telegram", {
        method: "POST",
        body: JSON.stringify({ any: "payload" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { user: Record<string, unknown> };

    expect(payload.user).toEqual({
      telegramId: "278674008",
      firstName: "Michael",
      lastName: "Dev",
      username: "laniameda",
      photoUrl: "https://example.com/avatar.jpg",
    });

    expect(state.createSessionCookieCalls).toEqual([payload.user]);
    expect(state.verifyCalls.length).toBe(1);
    expect(state.freshCalls[0]?.maxAge).toBe(5 * 60);
  });
});
