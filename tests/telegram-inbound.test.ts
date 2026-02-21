import { describe, expect, test } from "bun:test";
import {
  buildTelegramInboundIdempotencyKey,
  buildTelegramMessageIdempotencyKey,
  buildTelegramRunUserId,
  buildTelegramUpdateIdempotencyKey,
  normalizeTelegramUpdate,
} from "@/lib/telegram/inbound";

describe("normalizeTelegramUpdate", () => {
  test("normalizes text-only private chat updates", () => {
    const envelope = normalizeTelegramUpdate(
      {
        update_id: 101,
        message: {
          message_id: 7,
          chat: { id: 12345, type: "private" },
          from: {
            id: 777,
            username: "alice",
            first_name: "Alice",
            last_name: "Doe",
          },
          text: "Look at https://example.com and https://example.com",
        },
      },
      1_700_000_000_000,
    );

    expect(envelope).not.toBeNull();
    expect(envelope?.provider).toBe("telegram");
    expect(envelope?.chatType).toBe("direct");
    expect(envelope?.chatId).toBe("12345");
    expect(envelope?.messageId).toBe("7");
    expect(envelope?.fromUserId).toBe("777");
    expect(envelope?.fromUsername).toBe("alice");
    expect(envelope?.fromDisplayName).toBe("Alice Doe");
    expect(envelope?.links).toEqual(["https://example.com"]);
    expect(envelope?.receivedAt).toBe(1_700_000_000_000);
  });

  test("normalizes media and thread metadata", () => {
    const envelope = normalizeTelegramUpdate({
      update_id: 202,
      message: {
        message_id: 17,
        message_thread_id: 55,
        chat: { id: -999, type: "supergroup" },
        from: { id: 42, first_name: "Bob" },
        caption: "ref https://foo.test/path",
        photo: [
          { file_id: "small-photo", file_size: 111 },
          { file_id: "large-photo", file_size: 222 },
        ],
        document: {
          file_id: "doc-1",
          file_name: "brief.pdf",
          mime_type: "application/pdf",
          file_size: 333,
        },
      },
    });

    expect(envelope).not.toBeNull();
    expect(envelope?.chatType).toBe("supergroup");
    expect(envelope?.threadId).toBe("55");
    expect(envelope?.text).toBe("ref https://foo.test/path");
    expect(envelope?.media).toEqual([
      {
        mediaId: "large-photo",
        kind: "image",
        mimeType: "image/jpeg",
        sizeBytes: 222,
      },
      {
        mediaId: "doc-1",
        kind: "document",
        mimeType: "application/pdf",
        fileName: "brief.pdf",
        sizeBytes: 333,
      },
    ]);
  });

  test("returns null for unsupported payloads", () => {
    expect(normalizeTelegramUpdate({ update_id: 1 })).toBeNull();
    expect(normalizeTelegramUpdate({ message: { message_id: 1 } })).toBeNull();
  });

  test("accepts updates without update_id when message envelope is valid", () => {
    const envelope = normalizeTelegramUpdate({
      message: {
        message_id: 42,
        chat: { id: "999", type: "private" },
      },
    });
    expect(envelope).not.toBeNull();
    expect(envelope?.updateId).toBeUndefined();
    expect(envelope?.chatId).toBe("999");
    expect(envelope?.messageId).toBe("42");
  });
});

describe("telegram run helpers", () => {
  test("builds deterministic user and idempotency keys", () => {
    const envelope = normalizeTelegramUpdate({
      update_id: 321,
      message: {
        message_id: 9,
        chat: { id: 456, type: "group" },
      },
    });

    expect(envelope).not.toBeNull();
    expect(buildTelegramRunUserId(envelope!)).toBe("telegram:456");
    expect(buildTelegramUpdateIdempotencyKey(321)).toBe("telegram:update:321");
    expect(buildTelegramInboundIdempotencyKey(envelope!)).toBe("telegram:update:321");
  });

  test("uses chatId:messageId idempotency fallback when update_id is missing", () => {
    const envelope = normalizeTelegramUpdate({
      message: {
        message_id: 11,
        chat: { id: -777, type: "group" },
      },
    });
    expect(envelope).not.toBeNull();
    expect(buildTelegramMessageIdempotencyKey("-777", "11")).toBe("telegram:message:-777:11");
    expect(buildTelegramInboundIdempotencyKey(envelope!)).toBe("telegram:message:-777:11");
  });
});
