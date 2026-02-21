import { describe, expect, test } from "bun:test";
import {
  buildTelegramThreadParams,
  buildDummyPromptPackage,
  buildStagedMediaRelativePath,
  extractTelegramContextFromRunInput,
  isRetryableTelegramMediaError,
  resolveSandboxMediaUploadPath,
} from "@/agent-worker/telegram";

describe("extractTelegramContextFromRunInput", () => {
  test("extracts routing and envelope metadata from run input", () => {
    const context = extractTelegramContextFromRunInput({
      provider: "telegram",
      envelope: {
        provider: "telegram",
        updateId: 123,
        chatId: "-100100",
        messageId: "77",
        chatType: "supergroup",
        text: "hello",
      },
      routing: {
        chatId: "-100100",
        threadId: "42",
        replyToMessageId: "77",
      },
    });

    expect(context.routing).toEqual({
      chatId: "-100100",
      threadId: 42,
      replyToMessageId: 77,
      chatType: "supergroup",
    });
    expect(context.envelope?.messageId).toBe("77");
  });

  test("returns empty context for invalid input", () => {
    const context = extractTelegramContextFromRunInput({ foo: "bar" });
    expect(context.envelope).toBeUndefined();
    expect(context.routing).toBeUndefined();
  });
});

describe("buildStagedMediaRelativePath", () => {
  test("creates stable, sanitized workspace path", () => {
    const relative = buildStagedMediaRelativePath({
      messageId: "88",
      index: 1,
      kind: "document",
      fileName: "../unsafe name?.pdf",
      mimeType: "application/pdf",
    });

    expect(relative).toBe("media/inbound/88/02-unsafe-name-.pdf");
  });
});

describe("buildDummyPromptPackage", () => {
  test("includes media notes and intent metadata", () => {
    const output = buildDummyPromptPackage({
      intent: "ingest",
      source: "telegram",
      input: { prompt: "sample" },
      mediaNotes: ["[media attached: media/inbound/77/01-image.jpg (image/jpeg)]"],
    });

    expect(output).toContain("final_prompt");
    expect(output).toContain("media/inbound/77/01-image.jpg");
    expect(output).toContain("Intent: ingest");
    expect(output).toContain("Source: telegram");
  });
});

describe("buildTelegramThreadParams", () => {
  test("omits general topic id=1 for non-direct chats", () => {
    expect(buildTelegramThreadParams({ chatId: "-100", chatType: "supergroup", threadId: 1 })).toBeUndefined();
  });

  test("keeps thread id for direct chats", () => {
    expect(buildTelegramThreadParams({ chatId: "42", chatType: "direct", threadId: 1 })).toEqual({
      message_thread_id: 1,
    });
  });

  test("keeps non-general topics for groups", () => {
    expect(buildTelegramThreadParams({ chatId: "-100", chatType: "group", threadId: 7 })).toEqual({
      message_thread_id: 7,
    });
  });
});

describe("isRetryableTelegramMediaError", () => {
  test("marks oversize and 400 errors as non-retryable", () => {
    expect(isRetryableTelegramMediaError(new Error("file exceeds 20000000 bytes"))).toBeFalse();
    expect(isRetryableTelegramMediaError(new Error("download failed with status 400"))).toBeFalse();
  });

  test("marks transient network errors as retryable", () => {
    expect(isRetryableTelegramMediaError(new Error("connect timeout"))).toBeTrue();
  });
});

describe("resolveSandboxMediaUploadPath", () => {
  test("prefixes media path with sandbox workspace root", () => {
    expect(
      resolveSandboxMediaUploadPath({
        relativePath: "media/inbound/77/01-file.jpg",
        workspaceRoot: ".agent-runtime/workspace",
      }),
    ).toBe(".agent-runtime/workspace/media/inbound/77/01-file.jpg");
  });
});
