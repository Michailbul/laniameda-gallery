import { describe, test, expect } from "bun:test";
import { create, read, update } from "../convex/mjImageEdits";
import { startRun } from "../convex/mjQuickRuns";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };
function fixture() {
  const rows = new Map<string, Row>(); const scheduled: unknown[] = [];
  const ctx = { auth: { getUserIdentity: async () => ({ subject: "owner" }) },
    scheduler: { runAfter: async (...args: unknown[]) => { scheduled.push(args); } },
    db: {
      normalizeId: (table: string, id: string) => id.startsWith(`${table}:`) ? id : null,
      get: async (id: string) => rows.get(id) || null,
      insert: async (table: string, value: Record<string, unknown>) => { const id = `${table}:${rows.size + 1}`; rows.set(id, { ...value, _id: id, _creationTime: Date.now() }); return id; },
      patch: async (id: string, value: Record<string, unknown>) => { rows.set(id, { ...rows.get(id)!, ...value }); },
      query: (table: string) => ({ withIndex: (_name: string, build: (q: unknown) => unknown) => {
        const fields: Array<[string, unknown]> = []; const q = { eq: (key: string, value: unknown) => { fields.push([key, value]); return q; } }; build(q);
        return { unique: async () => [...rows.values()].find(row => row._id.startsWith(`${table}:`) && fields.every(([key, value]) => row[key] === value)) || null };
      } }),
    },
  };
  const call = (fn: unknown, args: Record<string, unknown>) => (fn as { _handler(ctx: unknown, args: unknown): Promise<Row> })._handler(ctx, { ownerUserId: "owner", ...args });
  return { rows, scheduled, call };
}
const source = { url: "https://images.example/source.png", width: 960, height: 540 };

describe("edit thread persistence and generation retries", () => {
  test("reopening a source is idempotent and cross-owner reads are rejected", async () => {
    const f = fixture(); const a = await f.call(create, { key: "frame-one", source });
    const b = await f.call(create, { key: "frame-one", source });
    expect(a._id).toBe(b._id); expect(f.rows.size).toBe(1);
    await expect(f.call(read, { id: a._id, ownerUserId: "someone-else" })).rejects.toThrow();
  });
  test("a lost send response reuses the stored run and schedules generation once", async () => {
    const f = fixture(); const thread = await f.call(create, { key: "frame-one", source });
    const args = { threadId: thread._id, requestKey: "same-send", source, model: "seedream-5.5", instruction: "Warm up the light", count: 3, refs: [] };
    const first = await f.call(startRun, args); const retry = await f.call(startRun, args);
    expect(first.runId).toBe(retry.runId); expect(f.scheduled).toHaveLength(1);
    expect(f.rows.get(thread._id)?.runIds).toEqual([first.runId]);
  });
  test("an old reply retry cannot roll a newer prompt draft back", async () => {
    const f = fixture(); const thread = await f.call(create, { key: "frame-one", source });
    const first = { id: thread._id, draft: "first", message: { id: "reply-one", role: "agent", text: "Ready", prompt: "first" } };
    await f.call(update, first); await f.call(update, { id: thread._id, draft: "newer" });
    const replay = await f.call(update, first);
    expect(replay.draft).toBe("newer"); expect(replay.messages).toHaveLength(1);
  });
  test("editing a take validates the exact finished picture and retains previous runs", async () => {
    const f = fixture(); const thread = await f.call(create, { key: "frame-one", source });
    const started = await f.call(startRun, { threadId: thread._id, requestKey: "first-run", source, model: "seedream-5.5", instruction: "Light", count: 1, refs: [] });
    const runId = started.runId as string;
    const activeSource = { url: "https://images.example/take.png", parentRunId: runId, parentIndex: 0 };
    await expect(f.call(update, { id: thread._id, activeSource })).rejects.toThrow("finished take");
    f.rows.set(runId, { ...f.rows.get(runId)!, takes: [{ status: "done", review: "pending", falUrl: activeSource.url }] });
    await expect(f.call(update, { id: thread._id, activeSource: { ...activeSource, url: "https://images.example/wrong.png" } })).rejects.toThrow("does not match");
    const saved = await f.call(update, { id: thread._id, activeSource });
    expect(saved.runIds).toEqual([runId]); expect(saved.activeSource).toEqual(activeSource);
  });
});
