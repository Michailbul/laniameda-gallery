import type { TelegramInboundEnvelope } from "@/lib/telegram/inbound";
import type { StagedTelegramMedia } from "./telegram";

export type AgentStreamingUserMessage = {
  type: "user";
  message: {
    role: "user";
    content: Array<Record<string, unknown>>;
  };
};

const textBlock = (text: string): Record<string, unknown> => ({
  type: "text",
  text,
});

const buildBaseInstructions = ({
  intent,
  source,
  input,
  mediaNotes,
}: {
  intent: string;
  source: string;
  input?: unknown;
  mediaNotes: string[];
}) => {
  return [
    "You are a UGC influencer image prompt construction agent.",
    "Generate an actionable prompt package for image creation.",
    "You must call the tool submit_ingest_payload exactly once before finalizing your answer.",
    "The submit_ingest_payload payload must never include any user identifier fields.",
    `Intent: ${intent}`,
    `Source: ${source}`,
    "Return concise output with:",
    "1) final_prompt",
    "2) negative_prompt",
    "3) generation_notes",
    "Media notes:",
    ...(mediaNotes.length > 0 ? mediaNotes : ["- none attached"]),
    `Input JSON: ${JSON.stringify(input ?? {}, null, 2)}`,
  ].join("\n");
};

const buildEnvelopeContext = (envelope?: TelegramInboundEnvelope) => {
  if (!envelope) {
    return "";
  }

  const lines = [
    "Telegram context:",
    `- chat_id: ${envelope.chatId}`,
    `- chat_type: ${envelope.chatType}`,
    `- message_id: ${envelope.messageId}`,
  ];
  if (envelope.threadId) {
    lines.push(`- thread_id: ${envelope.threadId}`);
  }
  if (envelope.links?.length) {
    lines.push(`- links: ${envelope.links.join(", ")}`);
  }
  return lines.join("\n");
};

const buildStagedMediaReference = (media: StagedTelegramMedia) => {
  if (!media.relativePath) {
    return "";
  }

  const header = `[staged media: ${media.relativePath} (${media.mimeType || "application/octet-stream"})]`;

  if (media.kind === "audio" || media.kind === "voice" || media.kind === "video") {
    return [
      header,
      "Use available tools to inspect/transcribe this media before forming the final prompt package.",
    ].join("\n");
  }

  if (media.kind === "document") {
    return [
      header,
      "Use available tools to read and extract relevant details from this document before the final output.",
    ].join("\n");
  }

  return header;
};

export const buildTelegramStreamingMessages = ({
  intent,
  source,
  input,
  envelope,
  mediaNotes,
  stagedMedia,
}: {
  intent: string;
  source: string;
  input?: unknown;
  envelope?: TelegramInboundEnvelope;
  mediaNotes: string[];
  stagedMedia: StagedTelegramMedia[];
}): AgentStreamingUserMessage[] => {
  const content: Array<Record<string, unknown>> = [];
  content.push(
    textBlock(
      [buildBaseInstructions({ intent, source, input, mediaNotes }), buildEnvelopeContext(envelope)]
        .filter(Boolean)
        .join("\n\n"),
    ),
  );
  if (envelope?.text) {
    content.push(textBlock(`User message text:\n${envelope.text}`));
  }
  if (envelope?.links?.length) {
    content.push(textBlock(`User links:\n${envelope.links.map((url) => `- ${url}`).join("\n")}`));
  }

  for (const media of stagedMedia) {
    if (media.directContentBlock) {
      content.push(media.directContentBlock);
      continue;
    }
    const stagedReference = buildStagedMediaReference(media);
    if (stagedReference) {
      content.push(textBlock(stagedReference));
    }
  }

  return [
    {
      type: "user",
      message: {
        role: "user",
        content,
      },
    },
  ];
};
