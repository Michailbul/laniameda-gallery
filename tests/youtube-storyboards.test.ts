import { expect, test } from "bun:test";
import { isYouTubeVideoId, parseYouTubePlayer, sampleYouTubeStoryboard, storyboardsFromWatchPage } from "../lib/youtube-storyboards";
import { youTubeFramesResponse } from "../lib/server/youtube-frames-response";

// Public player layout verified from 504koqyhKoo on 5 Oct 2026 (947 seconds).
// Query/signature strings are fixture values, never account credentials.
const template = "https://i.ytimg.com/sb/504koqyhKoo/storyboard3_L$L/$N.jpg?sqp=fixture";
const spec = `${template}|48#27#100#10#10#0#default#overview|80#45#96#10#10#10000#M$M#low|160#90#96#5#5#10000#M$M#medium|320#180#96#3#3#10000#M$M#high`;

test("highest timed level gives 24 distinct frames from opening through ending", () => {
  const frames = sampleYouTubeStoryboard(spec, 947);
  expect(frames).toHaveLength(24);
  expect(frames.slice(0, 4).map((frame) => frame.timeSeconds)).toEqual([0, 10, 20, 30]);
  expect(frames.at(-1)?.timeSeconds).toBe(940);
  expect(frames.every((frame) => frame.width === 320 && frame.height === 180)).toBe(true);
  expect(new Set(frames.map((frame) => `${frame.url}:${frame.column}:${frame.row}`)).size).toBe(24);
  const ending = frames.at(-1)!;
  expect(new URL(ending.url).pathname).toBe("/sb/504koqyhKoo/storyboard3_L3/M10.jpg");
  expect(new URL(ending.url).searchParams.get("sigh")).toBe("high");
  expect([ending.column, ending.row]).toEqual([1, 1]);
  expect([ending.columns, ending.rows]).toEqual([3, 2]);
});

test("short/sparse sprites never repeat frames or sample blank cells", () => {
  const frames = sampleYouTubeStoryboard(`${template}|320#180#7#3#3#5000#M$M#sig`, 100);
  expect(frames).toHaveLength(7);
  expect(frames.map((frame) => frame.timeSeconds)).toEqual([0, 5, 10, 15, 20, 25, 30]);
  expect(frames.at(-1)?.row).toBe(2);
  expect(frames.at(-1)?.column).toBe(0);
  expect(sampleYouTubeStoryboard(`${template}|160#90#100#5#5#1000#M$M#sig`, 2)).toHaveLength(3);
});

test("malformed/unusable top levels fall back to a valid timed level", () => {
  expect(sampleYouTubeStoryboard(`${template}|160#90#30#5#5#1000#M$M#ok|320#180#30#3#3#0#M$M#bad`, 30)[0]?.width).toBe(160);
  for (const invalid of ["", `${template}|0#90#10#5#5#1000#M$M#s`, `${template}|160#90#10#0#5#1000#M$M#s`, `${template}|160#90#10#5#5#NaN#M$M#s`]) {
    expect(sampleYouTubeStoryboard(invalid, 100)).toEqual([]);
  }
  expect(sampleYouTubeStoryboard(spec, NaN)).toEqual([]);
  expect(sampleYouTubeStoryboard(spec, 0)).toEqual([]);
});

test("only HTTPS i.ytimg.com images and strict video IDs are accepted", () => {
  for (const base of ["http://i.ytimg.com/$N.jpg", "https://i.ytimg.com.evil.test/$N.jpg", "https://localhost/$N.jpg", "https://user:password@i.ytimg.com/$N.jpg", "https://i.ytimg.com:3000/$N.jpg", "//i.ytimg.com/$N.jpg"]) {
    expect(sampleYouTubeStoryboard(`${base}|160#90#20#5#5#1000#M$M#s`, 20)).toEqual([]);
  }
  expect(isYouTubeVideoId("504koqyhKoo")).toBe(true);
  for (const id of ["../504koqyhKoo", "https://a.co", "504koqyhKoo?", "é04koqyhKoo"]) expect(isYouTubeVideoId(id)).toBe(false);
});

test("watch player extraction handles nested JSON and literal brace-semicolon text", () => {
  const player = { videoDetails: { lengthSeconds: "947", title: 'literal }; and escaped " brace {' }, storyboards: { playerStoryboardSpecRenderer: { spec } } };
  const html = `<script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script>`;
  expect(parseYouTubePlayer(html)).toEqual(player);
  expect(storyboardsFromWatchPage(html)).toHaveLength(24);
  expect(storyboardsFromWatchPage("<html>consent / restricted / unavailable</html>")).toEqual([]);
  expect(storyboardsFromWatchPage('var ytInitialPlayerResponse = {"videoDetails":{"lengthSeconds":"20"}};')).toEqual([]);
  expect(parseYouTubePlayer('var ytInitialPlayerResponse = {bad}; ytInitialPlayerResponse = {"ok":true};')).toEqual({ ok: true });
});

test("frame endpoint rejects locked visitors, unknown saved IDs and invalid IDs before fetch", async () => {
  let fetches = 0;
  const loadFrames = async () => { fetches++; return sampleYouTubeStoryboard(spec, 947); };
  const locked = await youTubeFramesResponse("504koqyhKoo", { loadVideos: async () => null, loadFrames });
  expect(locked.status).toBe(401);
  expect(await locked.json()).toEqual({ frames: [] });
  const missing = await youTubeFramesResponse("504koqyhKoo", { loadVideos: async () => [{ externalId: "abcdefghijk" }], loadFrames });
  expect(missing.status).toBe(404);
  const malformed = await youTubeFramesResponse("localhost", { loadVideos: async () => { throw new Error("must not load"); }, loadFrames });
  expect(malformed.status).toBe(400);
  expect(fetches).toBe(0);
});

test("authorized saved member returns only public frame metadata; later access still checked", async () => {
  const rows = [{ externalId: "504koqyhKoo", userNote: "owner only", bendIdea: "private proposal", isLiked: true }];
  const loadFrames = async () => sampleYouTubeStoryboard(spec, 947);
  const response = await youTubeFramesResponse("504koqyhKoo", { loadVideos: async () => rows, loadFrames });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = await response.text();
  expect(JSON.parse(body).frames).toHaveLength(24);
  expect(body).not.toContain("owner only");
  expect(body).not.toContain("private proposal");
  const locked = await youTubeFramesResponse("504koqyhKoo", { loadVideos: async () => null, loadFrames });
  expect(locked.status).toBe(401);
});

test("YouTube fetch failure keeps an authorized card usable with empty frames", async () => {
  const response = await youTubeFramesResponse("504koqyhKoo", {
    loadVideos: async () => [{ externalId: "504koqyhKoo" }],
    loadFrames: async () => { throw new Error("upstream blocked"); },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ frames: [] });
});
