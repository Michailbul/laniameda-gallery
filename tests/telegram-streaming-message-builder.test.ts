import { describe, expect, test } from "bun:test";
import { buildTelegramStreamingMessages } from "@/agent-worker/streaming-message-builder";

describe("buildTelegramStreamingMessages", () => {
  test("maps text and links to text content blocks", () => {
    const messages = buildTelegramStreamingMessages({
      intent: "ingest",
      source: "telegram",
      input: { sample: true },
      envelope: {
        provider: "telegram",
        chatId: "100",
        messageId: "200",
        chatType: "direct",
        text: "hello world",
        links: ["https://example.com"],
        receivedAt: Date.now(),
      },
      mediaNotes: [],
      stagedMedia: [],
    });

    const content = messages[0]?.message.content ?? [];
    expect(content.some((block) => block.type === "text" && `${block.text}`.includes("User message text"))).toBeTrue();
    expect(content.some((block) => block.type === "text" && `${block.text}`.includes("https://example.com"))).toBeTrue();
  });

  test("keeps direct image/document blocks and stages audio/video as tool instructions", () => {
    const messages = buildTelegramStreamingMessages({
      intent: "ingest",
      source: "telegram",
      input: {},
      envelope: {
        provider: "telegram",
        chatId: "100",
        messageId: "200",
        chatType: "supergroup",
        receivedAt: Date.now(),
      },
      mediaNotes: ["[media attached]"],
      stagedMedia: [
        {
          mediaId: "img-1",
          kind: "image",
          mimeType: "image/jpeg",
          relativePath: "media/inbound/200/01-file.jpg",
          directContentBlock: {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: "abc",
            },
          },
        },
        {
          mediaId: "doc-1",
          kind: "document",
          mimeType: "application/pdf",
          relativePath: "media/inbound/200/02-file.pdf",
          directContentBlock: {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: "def",
            },
            title: "Attachment",
          },
        },
        {
          mediaId: "audio-1",
          kind: "audio",
          mimeType: "audio/ogg",
          relativePath: "media/inbound/200/03-file.ogg",
        },
      ],
    });

    const content = messages[0]?.message.content ?? [];
    expect(content.some((block) => block.type === "image")).toBeTrue();
    expect(content.some((block) => block.type === "document")).toBeTrue();
    expect(
      content.some(
        (block) =>
          block.type === "text" &&
          `${block.text}`.includes("inspect/transcribe this media"),
      ),
    ).toBeTrue();
  });
});
