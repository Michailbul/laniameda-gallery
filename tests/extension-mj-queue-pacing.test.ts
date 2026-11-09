import { beforeAll, describe, expect, test } from "bun:test";

type Rate = { lastHour: number; inFlight: number; newestJobAt: number };
type PacingApi = {
  PACING: { gapMs: number; hourCap: number; maxInFlight: number };
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

  test("at least 20 s after the last send or the newest job", () => {
    const rate = { lastHour: 5, inFlight: 0, newestJobAt: now - 30_000 };
    expect(api().pacing({ rate, lastSendAt: now - 5_000, now })).toMatchObject({ ok: false, waitMs: 15_000 });
    expect(api().pacing({ rate: { ...rate, newestJobAt: now - 12_000 }, now }).waitMs).toBe(8_000);
    expect(api().pacing({ rate, lastSendAt: now - 25_000, now })).toMatchObject({ ok: true, waitMs: 0 });
  });

  test("30 jobs in the hour stops it and says why", () => {
    const gate = api().pacing({ rate: { lastHour: 30, inFlight: 0, newestJobAt: now - 600_000 }, now });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain("30");
  });

  test("two jobs still running hold the next one", () => {
    expect(api().pacing({ rate: { lastHour: 4, inFlight: 2, newestJobAt: now - 60_000 }, now }).ok).toBe(false);
  });
});
