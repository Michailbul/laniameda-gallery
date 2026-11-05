import { beforeAll, describe, expect, test } from "bun:test";

type Client = {
  check: (urls: string[]) => Promise<{ ok: boolean; error?: string; statuses?: Array<{ url: string; saved: boolean }> }>;
  markSaved: (url: string) => void;
};
type AssetStatusApi = {
  FAILURE_BACKOFF_MS: number;
  UNSAVED_TTL_MS: number;
  createAssetStatusClient: (options: {
    fetchStatuses: (urls: string[]) => Promise<unknown>;
    now?: () => number;
    batchDelayMs?: number;
  }) => Client;
};

let api: AssetStatusApi;
beforeAll(async () => {
  await import("../extension/asset-status.js");
  api = (globalThis as typeof globalThis & { SaveToGalleryAssetStatus: AssetStatusApi }).SaveToGalleryAssetStatus;
});

const setup = (respond: (urls: string[]) => unknown = (urls) => ({ ok: true, statuses: urls.map((url) => ({ url, saved: url.includes("saved") })) })) => {
  let clock = 1_000;
  const requests: string[][] = [];
  const client = api.createAssetStatusClient({
    now: () => clock,
    batchDelayMs: 5,
    fetchStatuses: async (urls) => {
      requests.push(urls);
      return respond(urls);
    },
  });
  return { client, requests, advance: (ms: number) => { clock += ms; } };
};

describe("extension saved-status client", () => {
  test("lookups made together share one request and are answered from cache afterwards", async () => {
    const { client, requests } = setup();
    const [a, b] = await Promise.all([client.check(["https://cdn/a-saved.png"]), client.check(["https://cdn/b.png"])]);
    expect(a).toEqual({ ok: true, statuses: [{ url: "https://cdn/a-saved.png", saved: true }] });
    expect(b).toEqual({ ok: true, statuses: [{ url: "https://cdn/b.png", saved: false }] });
    expect(requests).toEqual([["https://cdn/a-saved.png", "https://cdn/b.png"]]);
    await client.check(["https://cdn/a-saved.png", "https://cdn/b.png"]);
    expect(requests).toHaveLength(1);
  });

  test("an unsaved answer expires; a save marks the url saved without a request", async () => {
    const { client, requests, advance } = setup();
    await client.check(["https://cdn/c.png"]);
    client.markSaved("https://cdn/c.png");
    expect(await client.check(["https://cdn/c.png"])).toEqual({ ok: true, statuses: [{ url: "https://cdn/c.png", saved: true }] });
    await client.check(["https://cdn/d.png"]);
    advance(api.UNSAVED_TTL_MS + 1);
    await client.check(["https://cdn/d.png"]);
    expect(requests).toEqual([["https://cdn/c.png"], ["https://cdn/d.png"], ["https://cdn/d.png"]]);
  });

  test("a failure pauses lookups instead of retrying on every scan", async () => {
    let fail = true;
    const { client, requests, advance } = setup((urls) => fail ? { ok: false, error: "HTTP 503" } : { ok: true, statuses: urls.map((url) => ({ url, saved: false })) });
    expect((await client.check(["https://cdn/e.png"])).ok).toBe(false);
    expect((await client.check(["https://cdn/e.png"])).ok).toBe(false);
    expect(requests).toHaveLength(1);
    fail = false;
    advance(api.FAILURE_BACKOFF_MS + 1);
    expect((await client.check(["https://cdn/e.png"])).ok).toBe(true);
    expect(requests).toHaveLength(2);
  });

  test("more than eight urls are split into route-sized requests", async () => {
    const { client, requests } = setup();
    const urls = Array.from({ length: 12 }, (_, index) => `https://cdn/${index}.png`);
    await Promise.all([client.check(urls.slice(0, 8)), client.check(urls.slice(8))]);
    expect(requests.map((request) => request.length)).toEqual([8, 4]);
  });
  test("a save forgets cached \"not saved\" answers and outranks a lookup in flight", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { client, requests } = setup();
    await client.check(["https://cdn/grid-variant.webp"]);
    client.markSaved("https://cdn/full.png");
    // The variant is asked again: the server now matches it through the saved original.
    await client.check(["https://cdn/grid-variant.webp"]);
    expect(requests).toHaveLength(2);

    const slow = api.createAssetStatusClient({
      batchDelayMs: 1,
      fetchStatuses: async (urls) => { await gate; return { ok: true, statuses: urls.map((url) => ({ url, saved: false })) }; },
    });
    const pending = slow.check(["https://cdn/racing.png"]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    slow.markSaved("https://cdn/racing.png");
    release!();
    expect(await pending).toEqual({ ok: true, statuses: [{ url: "https://cdn/racing.png", saved: true }] });
    expect(await slow.check(["https://cdn/racing.png"])).toEqual({ ok: true, statuses: [{ url: "https://cdn/racing.png", saved: true }] });
  });
});
