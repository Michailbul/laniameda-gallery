import { beforeAll, describe, expect, test } from "bun:test";

type Row = { key: string; at: number; rev: number; entry: string };
type Seen = Record<string, { rev: number; h: string }>;
type Merge = { list: Array<Record<string, unknown>>; push: Array<{ key: string; at: number; entry: string; baseRev?: number }>; seen: Seen };
type Api = {
  hash: (text: string) => string;
  merge: (kind: "grow" | "describe", local: unknown[], rows: Row[], seen?: Seen) => Merge;
  createSyncer: (deps: { fetchJson: (path: string, init: { method: string; body?: string }) => Promise<unknown>; storage: { get: (key: string) => Promise<Record<string, unknown>>; set: (value: Record<string, unknown>) => Promise<void> } }) => {
    sync: (kind: string, opts?: { force?: boolean }) => Promise<{ ok: boolean; pushed?: number; changed?: boolean }>;
  };
};

let api: Api;
beforeAll(async () => {
  await import("../extension/history-sync.js");
  api = (globalThis as unknown as { SaveToGalleryHistorySync: Api }).SaveToGalleryHistorySync;
});

const grow = (key: string, at: number, runs: Array<{ id: string; at: number }>) => ({ key, at, thumb: `t-${key}`, runs });
const row = (entry: { key?: string; imageUrl?: string; at: number }, rev: number): Row => ({ key: (entry.key || entry.imageUrl)!, at: entry.at, rev, entry: JSON.stringify(entry) });

describe("history merge", () => {
  test("a picture only in the gallery comes down; one only here goes up", () => {
    const here = grow("a", 2, [{ id: "r1", at: 2 }]);
    const there = grow("b", 3, [{ id: "r2", at: 3 }]);
    const out = api.merge("grow", [here], [row(there, 10)]);
    expect(out.list.map((e) => e.key)).toEqual(["b", "a"]);
    expect(out.push.map((p) => p.key)).toEqual(["a"]);
    expect(out.seen.b.rev).toBe(10);
  });

  test("unchanged here since the last sync: the gallery's newer version wins, nothing goes up", () => {
    const old = grow("a", 1, [{ id: "r1", at: 1 }]);
    const newer = grow("a", 5, [{ id: "r2", at: 5 }, { id: "r1", at: 1 }]);
    const seen = { a: { rev: 3, h: api.hash(JSON.stringify(old)) } };
    const out = api.merge("grow", [old], [row(newer, 7)], seen);
    expect(out.list[0]).toEqual(newer);
    expect(out.push).toEqual([]);
  });

  test("changed only here: ours goes up on top of the gallery's rev", () => {
    const base = grow("a", 1, [{ id: "r1", at: 1 }]);
    const mine = grow("a", 4, [{ id: "r3", at: 4 }, { id: "r1", at: 1 }]);
    const out = api.merge("grow", [mine], [row(base, 3)], { a: { rev: 3, h: api.hash(JSON.stringify(base)) } });
    expect(out.list[0]).toEqual(mine);
    expect(out.push).toEqual([{ key: "a", at: 4, entry: JSON.stringify(mine), baseRev: 3 }]);
  });

  test("changed in two browsers: Grow keeps the runs of both, newest first", () => {
    const mine = grow("a", 4, [{ id: "r3", at: 4 }, { id: "r1", at: 1 }]);
    const theirs = grow("a", 6, [{ id: "r4", at: 6 }, { id: "r1", at: 1 }]);
    const out = api.merge("grow", [mine], [row(theirs, 9)], { a: { rev: 3, h: "old" } });
    expect((out.list[0].runs as Array<{ id: string }>).map((r) => r.id)).toEqual(["r4", "r3", "r1"]);
    expect(out.push[0].baseRev).toBe(9);
  });

  test("describe keeps the newer one and the list is capped", () => {
    const local = Array.from({ length: 30 }, (_, i) => ({ imageUrl: `u${i}`, at: i, descriptions: ["x"] }));
    const out = api.merge("describe", local, []);
    expect(out.list.length).toBe(24);
    expect(out.list[0].imageUrl).toBe("u29");
    expect(out.push.length).toBe(24);
  });

  test("a picture that fell off the gallery's list is not sent up again", () => {
    const entry = grow("a", 1, [{ id: "r1", at: 1 }]);
    const out = api.merge("grow", [entry], [], { a: { rev: 2, h: api.hash(JSON.stringify(entry)) } });
    expect(out.push).toEqual([]);
    expect(out.list).toEqual([entry]);
  });
});

describe("syncer", () => {
  test("two browsers converge on one list", async () => {
    const server = new Map<string, Row>();
    let rev = 0;
    const fetchJson = async (path: string, init: { method: string; body?: string }) => {
      if (init.method === "GET") return { ok: true, rows: [...server.values()].sort((a, b) => b.at - a.at) };
      const body = JSON.parse(init.body!);
      return { ok: true, rows: body.rows.map((r: { key: string; at: number; entry: string; baseRev?: number }) => {
        const old = server.get(r.key);
        if (old && r.baseRev !== undefined && old.rev > r.baseRev) return { key: r.key, rev: old.rev, stale: true, entry: old.entry, at: old.at };
        rev += 1;
        server.set(r.key, { key: r.key, at: r.at, rev, entry: r.entry });
        return { key: r.key, rev, stale: false };
      }) };
    };
    const browser = (initial: unknown[]) => {
      const store: Record<string, unknown> = { growHistory: initial };
      const storage = { get: async (key: string) => ({ [key]: store[key] }), set: async (value: Record<string, unknown>) => { Object.assign(store, value); } };
      return { store, syncer: api.createSyncer({ fetchJson, storage }) };
    };
    const a = browser([grow("a1", 1, [{ id: "x", at: 1 }])]);
    const b = browser([grow("b1", 2, [{ id: "y", at: 2 }])]);
    expect((await a.syncer.sync("grow", { force: true })).ok).toBe(true);
    expect((await b.syncer.sync("grow", { force: true })).ok).toBe(true);
    await a.syncer.sync("grow", { force: true });
    const keys = (s: Record<string, unknown>) => (s.growHistory as Array<{ key: string }>).map((e) => e.key);
    expect(keys(a.store)).toEqual(["b1", "a1"]);
    expect(keys(b.store)).toEqual(["b1", "a1"]);
    // A quiet second round sends nothing.
    const again = await a.syncer.sync("grow", { force: true });
    expect(again.pushed).toBe(0);
    expect(again.changed).toBe(false);
  });
});
