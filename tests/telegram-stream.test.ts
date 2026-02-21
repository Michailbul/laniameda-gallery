import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTelegramStreamSender } from "@/agent-worker/telegram-stream";

type FetchCall = {
  method: string;
  payload: Record<string, unknown>;
};

describe("createTelegramStreamSender", () => {
  const originalFetch = global.fetch;
  const calls: FetchCall[] = [];

  beforeEach(() => {
    calls.length = 0;
    global.fetch = (async (_url: string | URL, init?: RequestInit) => {
      const url = String(_url);
      const method = url.split("/").pop() || "";
      const payload = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      calls.push({ method, payload });

      if (method === "sendMessageDraft") {
        return new Response(
          JSON.stringify({ ok: false, error_code: 404, description: "Method not found" }),
          { status: 404 },
        );
      }

      if (method === "sendMessage") {
        return new Response(JSON.stringify({ ok: true, result: { message_id: 71 } }), { status: 200 });
      }

      if (method === "editMessageText" || method === "sendChatAction") {
        return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
      }

      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("falls back from sendMessageDraft to sendMessage + editMessageText", async () => {
    const sender = createTelegramStreamSender({
      botToken: "token",
      routing: {
        chatId: "123",
      },
      flushIntervalMs: 250,
      typingIntervalMs: 30_000,
    });

    sender.appendTextDelta("Hello");
    await sender.flush();
    sender.appendTextDelta(" world");
    await sender.flush();
    await sender.complete("Hello world");

    const methods = calls.map((entry) => entry.method);
    expect(methods.includes("sendMessageDraft")).toBeTrue();
    expect(methods.includes("sendMessage")).toBeTrue();
    expect(methods.includes("editMessageText")).toBeTrue();
  });
});
