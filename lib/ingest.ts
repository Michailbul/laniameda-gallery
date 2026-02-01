export const parseTagNames = (value?: string | string[] | null) => {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : value.split(",");
  const cleaned = raw.map((item) => item.trim()).filter(Boolean);
  return Array.from(new Set(cleaned));
};

export const fileToBase64 = async (file: File) => {
  const buffer = Buffer.from(await file.arrayBuffer());
  return buffer.toString("base64");
};

export const buildIngestKey = (input: {
  ingestKey?: string | null;
  url?: string | null;
  promptText?: string | null;
  fileName?: string | null;
}) => {
  if (input.ingestKey?.trim()) return input.ingestKey.trim();
  const parts = [input.url, input.fileName, input.promptText]
    .map((part) => part?.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts.join("|").slice(0, 500);
};
