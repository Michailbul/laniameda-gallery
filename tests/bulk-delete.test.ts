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

  test("bounds simultaneous deletes and does nothing for an empty selection", async () => {
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
    expect(peak).toBe(3);
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
