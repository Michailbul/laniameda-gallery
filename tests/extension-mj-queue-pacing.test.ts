import { beforeAll, describe, expect, test } from "bun:test";

type Rate = { lastHour: number; inFlight: number; newestJobAt: number };
type PacingApi = {
  PACING: { gapMs: number; hourNote: number };
  pacing: (input: { rate: Rate | null; lastSendAt?: number; now?: number }) => { ok: boolean; waitMs: number; lastHour: number | null; reason: string };
  rateFromHistory: (rows: { enqueue_time: string }[], queue: { running?: unknown[]; waiting?: unknown[] } | null, now?: number) => Rate;
};
const api = () => (globalThis as typeof globalThis & { SaveToGalleryMjQueue: PacingApi }).SaveToGalleryMjQueue;

beforeAll(async () => {
  await import("../extension/mj-queue.js");
});

describe("Next · Send pacing", () => {
  const now = Date.parse("2026-11-09T20:00:00Z");

  test("history rows of the last hour plus jobs in flight count", () => {
    const rows = [
      { enqueue_time: "2026-11-09T19:59:30.1+00:00" },
      { enqueue_time: "2026-11-09T19:10:00+00:00" },
      { enqueue_time: "2026-11-09T18:30:00+00:00" },
    ];
    const rate = api().rateFromHistory(rows, { running: [{}], waiting: [] }, now);
    expect(rate.lastHour).toBe(3);
    expect(rate.inFlight).toBe(1);
    expect(rate.newestJobAt).toBe(Date.parse("2026-11-09T19:59:30.1Z"));
  });

  test("no wait between his clicks", () => {
    const rate = { lastHour: 5, inFlight: 0, newestJobAt: now - 2_000 };
    expect(api().pacing({ rate, lastSendAt: now - 1_000, now })).toMatchObject({ ok: true, waitMs: 0, reason: "" });
  });

  test("his own clicks are not capped at 30 an hour or by jobs still running", () => {
    expect(api().pacing({ rate: { lastHour: 44, inFlight: 0, newestJobAt: now - 600_000 }, now })).toMatchObject({ ok: true, reason: "" });
    expect(api().pacing({ rate: { lastHour: 4, inFlight: 5, newestJobAt: now - 60_000 }, now }).ok).toBe(true);
  });

  test("past 150 in the hour it warns but still sends", () => {
    const gate = api().pacing({ rate: { lastHour: 160, inFlight: 0, newestJobAt: now - 600_000 }, now });
    expect(gate.ok).toBe(true);
    expect(gate.reason).toContain("160");
  });
});
