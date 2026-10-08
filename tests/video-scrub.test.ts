import { describe, expect, test } from "bun:test";
import { createVideoScrubber, videoScrubTime, VIDEO_SCRUB_INTERVAL_MS } from "../lib/video-scrub";

function harness() {
  let now = 0;
  let currentTime = 0;
  const seeks: number[] = [];
  const tasks = new Map<number, { at: number; callback: () => void }>();
  let nextId = 0;
  const video = {
    duration: 12, readyState: 1, seeking: false,
    get currentTime() { return currentTime; },
    set currentTime(value: number) { currentTime = value; seeks.push(value); },
  };
  const scrubber = createVideoScrubber(video, {
    now: () => now,
    schedule: (callback, delay) => {
      tasks.set(++nextId, { at: now + delay, callback });
      return nextId;
    },
    cancel: (id) => { tasks.delete(id as number); },
  });
  const advance = (ms: number) => {
    now += ms;
    for (const [id, task] of tasks) {
      if (task.at <= now) { tasks.delete(id); task.callback(); }
    }
  };
  return { video, seeks, tasks, scrubber, advance };
}

describe("cursor video scrubbing", () => {
  test("clamps and samples frames without seeking to the video's ended state", () => {
    expect(videoScrubTime(-1, 10)).toBe(0.001);
    expect(videoScrubTime(2, 10)).toBe(9.95);
    expect(videoScrubTime(0.5001, 10)).toBe(videoScrubTime(0.5, 10));
    expect(videoScrubTime(1, 0.01)).toBe(0.005);
    for (const duration of [0, -1, Infinity, NaN]) expect(videoScrubTime(0.5, duration)).toBeNull();
  });

  test("coalesces pointer bursts into the latest frame and skips unchanged samples", () => {
    const { scrubber, seeks, tasks, advance } = harness();
    scrubber.seek(0.1);
    scrubber.seek(0.3);
    scrubber.seek(0.5);
    scrubber.seek(0.9);
    expect(seeks).toHaveLength(1);
    expect(tasks.size).toBe(1);
    advance(VIDEO_SCRUB_INTERVAL_MS - 1);
    expect(seeks).toHaveLength(1);
    advance(1);
    expect(seeks).toHaveLength(2);
    expect(seeks[1]).toBe(videoScrubTime(0.9, 12));
    scrubber.seek(0.9001);
    advance(VIDEO_SCRUB_INTERVAL_MS);
    expect(seeks).toHaveLength(2);
  });

  test("waits for metadata and an in-flight seek before decoding the newest target", () => {
    const { scrubber, video, seeks, advance } = harness();
    video.readyState = 0;
    scrubber.seek(0.25);
    expect(seeks).toHaveLength(0);
    video.readyState = 1;
    scrubber.flush();
    video.seeking = true;
    scrubber.seek(0.75);
    scrubber.seek(1);
    advance(1000);
    expect(seeks).toHaveLength(1);
    video.seeking = false;
    scrubber.flush();
    expect(seeks).toEqual([videoScrubTime(0.25, 12), videoScrubTime(1, 12)]);
  });

  test("leaving the preview cancels queued work", () => {
    const { scrubber, seeks, tasks, advance } = harness();
    scrubber.seek(0.25);
    scrubber.seek(0.75);
    scrubber.dispose();
    expect(tasks.size).toBe(0);
    advance(1000);
    scrubber.seek(1);
    expect(seeks).toHaveLength(1);
  });
});
