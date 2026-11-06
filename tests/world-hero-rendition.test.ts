import { afterEach, describe, expect, test } from "bun:test";
import { widestCandidate } from "../components/world-page/world-insert";
import { TopazKeyError, topazEnhance } from "../lib/topaz";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("hero rendition", () => {
  test("the widest srcset candidate decides whether a hero has its 4K file", () => {
    expect(widestCandidate(undefined)).toBe(0);
    expect(widestCandidate("a.webp 480w, b.webp 960w, c.webp 1440w")).toBe(1440);
    expect(widestCandidate("a.webp 480w, c.webp 1440w, d.jpg 2560w, e.jpg 5120w")).toBe(5120);
  });

  test("topaz sends the hero settings and returns the image", async () => {
    let sent: FormData | undefined;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent = init.body as FormData;
      return new Response(new Blob(["jpeg"]), { status: 200, headers: { "content-type": "image/jpeg" } });
    }) as unknown as typeof fetch;
    const out = await topazEnhance({ apiKey: "k", image: new Blob(["png"]) });
    expect(await out.text()).toBe("jpeg");
    expect(sent?.get("model")).toBe("Standard V2");
    expect(sent?.get("output_width")).toBe("5120");
    expect(sent?.get("output_format")).toBe("jpeg");
  });

  test("a key out of credit is a key error, so the script moves to the next key", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: "Insufficient credits" }), {
        status: 402,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    expect(topazEnhance({ apiKey: "k", image: new Blob(["png"]) })).rejects.toBeInstanceOf(TopazKeyError);
  });
});
