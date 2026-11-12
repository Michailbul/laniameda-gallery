// Gemini Decision 1 (Google's decision model, 11 Nov 2026): typed questions
// about text, pictures and video, answered with calibrated probabilities.
// One HTTPS call, media passed by public URL, so it needs no Node runtime and
// no image conversion. Docs: https://aistudio.google.com/docs/decisions-api
//
// Measured on the gallery (12 Nov 2026): about 0.9 s a call, 60 calls at once
// in about 1.5 s, ~650 tokens for a picture at low resolution plus its words
// and two questions, $0.10 per million input tokens (about $0.00007 a piece).

const API_URL = "https://generativelanguage.googleapis.com/v1beta/decisions";
export const GEMINI_DECISION_MODEL = "gemini-decision-1";

export type DecisionQuestion =
  | { type: "noul"; instructions: string; criteria?: { true_description: string; false_description: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

export type DecisionAnswer = {
  type?: string;
  noul?: number;
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
};

export type DecisionInput =
  | { type: "text"; text: string }
  | { type: "image" | "video"; uri: string; mime_type: string; resolution?: "low" | "medium" | "high" };

/** The model cannot be used at all right now (no key, no credit, a refused key): asking again would fail the same way. */
export class DecisionUnavailable extends Error {}

export const geminiDecisionEnabled = () =>
  Boolean(process.env.GEMINI_API_KEY?.trim()) &&
  process.env.GEMINI_DECISIONS_ENABLED?.trim().toLowerCase() !== "false";

const IMAGE_TYPES: Array<[RegExp, string]> = [
  [/\.png(?:$|[?#])/i, "image/png"],
  [/\.jpe?g(?:$|[?#])/i, "image/jpeg"],
  [/\.gif(?:$|[?#])/i, "image/gif"],
];

/** A picture by its public URL. The gallery's renditions are WebP unless the URL says otherwise. */
export const pictureInput = (url: string): DecisionInput => ({
  type: "image",
  uri: url,
  mime_type: IMAGE_TYPES.find(([pattern]) => pattern.test(url))?.[1] ?? "image/webp",
  resolution: "low",
});

const isUnavailable = (status: number, body: string) =>
  status === 401 || status === 402 || status === 403 ||
  (status === 429 && /credit|quota|billing|prepay/i.test(body));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const RETRY_DELAYS_MS = [400, 1200];

/**
 * Ask every question about one input. Returns the answers by question key, or
 * null when this one input could not be judged (blocked by the safety filter,
 * a malformed picture, a busy server after retries). Throws DecisionUnavailable
 * when the provider cannot be used at all.
 */
export const askGeminiDecision = async (
  input: DecisionInput[],
  questions: Record<string, DecisionQuestion>,
): Promise<Record<string, DecisionAnswer> | null> => {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new DecisionUnavailable("GEMINI_API_KEY is not set.");
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ model: GEMINI_DECISION_MODEL, input, questions }),
      });
    } catch {
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]!);
        continue;
      }
      return null;
    }
    if (response.ok) {
      const body = (await response.json()) as { answers?: Record<string, DecisionAnswer> };
      return body.answers ?? null;
    }
    const text = (await response.text().catch(() => "")).slice(0, 300);
    if (isUnavailable(response.status, text)) {
      throw new DecisionUnavailable(`Gemini Decision HTTP ${response.status}: ${text}`);
    }
    // 400: the input was refused (safety filter, unreadable media). Not worth a retry.
    if (response.status < 429 || attempt >= RETRY_DELAYS_MS.length) return null;
    await sleep(RETRY_DELAYS_MS[attempt]!);
  }
};
