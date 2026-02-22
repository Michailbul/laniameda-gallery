import { describe, expect, test } from "bun:test";
import {
  buildDevTelegramEnvelope,
  buildDevTelegramIdempotencyKey,
  inferMediaKindFromMimeOrName,
} from "@/lib/dev-telegram-sim";

describe("dev telegram sim helpers", () => {
  test("buildDevTelegramEnvelope normalizes links from explicit links and text", () => {
    const envelope = buildDevTelegramEnvelope({
      chatId: "chat-1",
      messageId: "msg-1",
      chatType: "direct",
      text: "check this https://example.com",
      links: ["https://another.test", "https://example.com"],
      media: [
        {
          mediaId: "media-1",
          kind: "image",
          mimeType: "image/jpeg",
          fileName: "photo.jpg",
          sizeBytes: 123,
        },
      ],
    });

    expect(envelope.provider).toBe("telegram");
    expect(envelope.chatId).toBe("chat-1");
    expect(envelope.messageId).toBe("msg-1");
    expect(envelope.links).toEqual(["https://another.test", "https://example.com"]);
    expect(envelope.media?.[0]?.mediaId).toBe("media-1");
  });

  test("buildDevTelegramIdempotencyKey is deterministic", () => {
    const first = buildDevTelegramIdempotencyKey({
      chatId: "chat-1",
      text: "hello",
      mediaIds: ["a", "b"],
    });
    const second = buildDevTelegramIdempotencyKey({
      chatId: "chat-1",
      text: "hello",
      mediaIds: ["a", "b"],
    });

    expect(first).toBe(second);
    expect(first.startsWith("dev_telegram:chat-1:hash:")).toBeTrue();
  });

  test("prefers explicit message id in idempotency key", () => {
    const key = buildDevTelegramIdempotencyKey({
      chatId: "chat-1",
      messageId: "42",
      text: "hello",
    });

    expect(key).toBe("dev_telegram:chat-1:42");
  });

  test("inferMediaKindFromMimeOrName maps common formats", () => {
    expect(inferMediaKindFromMimeOrName({ mimeType: "image/png" })).toBe("image");
    expect(inferMediaKindFromMimeOrName({ mimeType: "video/mp4" })).toBe("video");
    expect(inferMediaKindFromMimeOrName({ mimeType: "audio/mpeg" })).toBe("audio");
    expect(inferMediaKindFromMimeOrName({ fileName: "voice.ogg" })).toBe("voice");
    expect(inferMediaKindFromMimeOrName({ fileName: "doc.pdf" })).toBe("document");
  });
});
