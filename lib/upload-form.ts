import { buildIngestKey, parseTagNames } from "@/lib/ingest";

export type UploadFormInput = {
  promptText: string;
  allowPromptOnly?: boolean;
  url?: string | null;
  folderId?: string | null;
  tags?: string[];
  file?: File | null;
  modelName?: string | null;
  pillar?: string | null;
  generationType?: string | null;
  promptType?: string | null;
  domain?: string | null;
};

export const buildUploadFormData = ({
  promptText,
  allowPromptOnly,
  url,
  folderId,
  tags,
  file,
  modelName,
  pillar,
  generationType,
  promptType,
  domain,
}: UploadFormInput) => {
  const trimmedPrompt = promptText?.trim() ?? "";
  const trimmedUrl = url?.trim();
  const formData = new FormData();

  if (trimmedPrompt) {
    formData.append("prompt", trimmedPrompt);
    formData.append("promptText", trimmedPrompt);
  }
  if (allowPromptOnly) {
    formData.append("allowPromptOnly", "true");
  }

  if (trimmedUrl) {
    formData.append("url", trimmedUrl);
  }

  const ingestKey = buildIngestKey({
    promptText: trimmedPrompt || undefined,
    url: trimmedUrl || undefined,
    fileName: file?.name,
  });
  const promptKey = buildIngestKey({ promptText: trimmedPrompt || undefined });

  if (ingestKey) {
    formData.append("ingestKey", ingestKey);
  }

  if (promptKey) {
    formData.append("promptIngestKey", promptKey);
  }

  const normalizedFolderId = folderId?.trim();
  if (normalizedFolderId) {
    formData.append("folderId", normalizedFolderId);
  }

  parseTagNames(tags).forEach((tag) => formData.append("tags", tag));

  if (file) {
    formData.append("file", file);
  }

  if (modelName) {
    formData.append("modelName", modelName);
  }
  if (pillar) {
    formData.append("pillar", pillar);
  }
  if (generationType) {
    formData.append("generationType", generationType);
  }
  if (promptType) {
    formData.append("promptType", promptType);
  }
  if (domain) {
    formData.append("domain", domain);
  }

  return formData;
};
