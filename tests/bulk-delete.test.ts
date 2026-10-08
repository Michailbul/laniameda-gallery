import { describe, expect, test } from "bun:test";
import { deleteAssetSelection } from "../lib/bulk-delete";

describe("bulk asset deletion", () => {
  test("deletes only the distinct selection through the authenticated endpoint", async () => {
    const calls: string[] = [];
    const results = await deleteAssetSelection(["first", "second/asset", "first"], {
      request: (async (url, init) => {
        calls.push(String(url));
        expect(init?.method).toBe("DELETE");
        return Response.json({ deleted: true });
      }) as typeof fetch,
    });
    expect(calls.sort()).toEqual(["/api/assets/first", "/api/assets/second%2Fasset"]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results).toHaveLength(2);
  });

  test("HTTP and network failures do not abandon the rest of the selection", async () => {
    const progress: number[] = [];
    const results = await deleteAssetSelection(["ok", "denied", "offline", "also-ok"], {
      request: (async (url) => {
        if (String(url).endsWith("denied")) {
          return Response.json({ error: "Not authorized." }, { status: 403 });
        }
        if (String(url).endsWith("offline")) throw new Error("Connection lost.");
        return Response.json({ deleted: true });
      }) as typeof fetch,
      onResult: (_result, completed, total) => {
        progress.push(completed);
        expect(total).toBe(4);
      },
    });
    expect(results.filter((result) => result.ok).map((result) => result.assetId).sort())
      .toEqual(["also-ok", "ok"]);
    expect(results.filter((result) => !result.ok).map((result) => result.error).sort())
      .toEqual(["Connection lost.", "Not authorized."]);
    expect(progress).toEqual([1, 2, 3, 4]);
  });

  test("serializes deletes that share tag counters and does nothing for an empty selection", async () => {
    let active = 0;
    let peak = 0;
    let called = 0;
    const request = (async () => {
      called++;
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return Response.json({ deleted: true });
    }) as typeof fetch;
    expect(await deleteAssetSelection([], { request })).toEqual([]);
    expect(called).toBe(0);
    await deleteAssetSelection(Array.from({ length: 20 }, (_, i) => String(i)), { request });
    expect(called).toBe(20);
    expect(peak).toBe(1);
  });

  test("retries an uncommitted Convex conflict before advancing progress or deleting the next asset", async () => {
    const calls: string[] = [];
    const progress: number[] = [];
    const results = await deleteAssetSelection(["busy", "next"], {
      request: (async (url) => {
        calls.push(String(url));
        if (calls.length <= 2) {
          return Response.json({ error: JSON.stringify({
            code: "OptimisticConcurrencyControlFailure",
            message: 'Documents read from or written to the "tags" table changed.',
          }) }, { status: 500 });
        }
        return Response.json({ deleted: true });
      }) as typeof fetch,
      onResult: (_result, completed) => { progress.push(completed); },
    });
    expect(calls).toEqual([
      "/api/assets/busy", "/api/assets/busy", "/api/assets/busy", "/api/assets/next",
    ]);
    expect(results).toEqual([{ assetId: "busy", ok: true }, { assetId: "next", ok: true }]);
    expect(progress).toEqual([1, 2]);
  });

  test("bounds persistent conflict retries, reports a readable error and continues the selection", async () => {
    const calls: string[] = [];
    const results = await deleteAssetSelection(["busy", "next"], {
      request: (async (url) => {
        calls.push(String(url));
        return String(url).endsWith("busy")
          ? Response.json({ error: "OptimisticConcurrencyControlFailure" }, { status: 500 })
          : Response.json({ deleted: true });
      }) as typeof fetch,
    });
    expect(calls).toEqual([
      "/api/assets/busy", "/api/assets/busy", "/api/assets/busy", "/api/assets/next",
    ]);
    expect(results).toEqual([
      { assetId: "busy", ok: false, error: "The gallery is busy updating these assets. Please retry deletion." },
      { assetId: "next", ok: true },
    ]);
  });

  test("does not retry auth, unrelated server or ambiguous network failures", async () => {
    const calls: string[] = [];
    const results = await deleteAssetSelection(["auth", "server", "network"], {
      request: (async (url) => {
        calls.push(String(url));
        if (String(url).endsWith("network")) throw new Error("Connection lost.");
        if (String(url).endsWith("auth")) {
          return Response.json({ error: "Not authorized." }, { status: 403 });
        }
        return Response.json({ error: "Storage cleanup failed." }, { status: 500 });
      }) as typeof fetch,
    });
    expect(calls).toEqual(["/api/assets/auth", "/api/assets/server", "/api/assets/network"]);
    expect(results.every((result) => !result.ok)).toBe(true);
  });

  test("keeps the original selection when it changes during deletion", async () => {
    const selection = ["first", "second"];
    const calls: string[] = [];
    const results = await deleteAssetSelection(selection, {
      request: (async (url) => {
        calls.push(String(url));
        selection.push("added-later");
        return Response.json({ deleted: true });
      }) as typeof fetch,
    });
    expect(calls.sort()).toEqual(["/api/assets/first", "/api/assets/second"]);
    expect(results).toHaveLength(2);
  });
});
