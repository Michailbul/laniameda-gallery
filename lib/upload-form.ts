import { buildIngestKey, parseTagNames } from "@/lib/ingest";

export type UploadFormInput = {
  promptText: string;
  url?: string | null;
  folderId?: string | null;
  tags?: string[];
  file?: File | null;
};

export const buildUploadFormData = ({
  promptText,
  url,
  folderId,
  tags,
  file,
}: UploadFormInput) => {
  const trimmedPrompt = promptText?.trim() ?? "";
  const trimmedUrl = url?.trim();
  const formData = new FormData();

  if (trimmedPrompt) {
    formData.append("prompt", trimmedPrompt);
    formData.append("promptText", trimmedPrompt);
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

  return formData;
};
