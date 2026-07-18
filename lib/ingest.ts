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

// Midjourney serves one generation under several CDN URL variants — grids use
// `<jobId>/0_1_640_N.webp?method=shortest`, the job viewer uses
// `<jobId>/0_1.jpeg` — while extension saves key assets by exact URL. To ask
// "is this image already saved?" across variants, widen the exact-key check
// with ingestKey prefixes that cover every variant of the same job image.
// The two prefixes end at the variant boundary (`.` and `_`) so `0_1` never
// matches `0_10`.
export const buildMidjourneyIngestKeyPrefixes = (rawUrl?: string | null) => {
  const value = rawUrl?.trim();
  if (!value) return [];

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return [];
  }

  const host = url.hostname.toLowerCase();
  if (host !== "cdn.midjourney.com" && !host.endsWith(".cdn.midjourney.com")) {
    return [];
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return [];

  const [jobId, fileName] = segments;
  if (!/^[0-9a-f][0-9a-f-]{15,}$/i.test(jobId)) return [];

  const variantMatch = /^(\d+_\d+)[._]/.exec(fileName);
  if (!variantMatch) return [];

  const base = `${url.origin}/${jobId}/${variantMatch[1]}`;
  return [`${base}.`, `${base}_`];
};
