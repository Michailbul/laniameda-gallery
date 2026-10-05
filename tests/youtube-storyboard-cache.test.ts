import { expect, test } from "bun:test";
import { readStoryboardCache, storyboardCacheKey } from "../lib/youtube-storyboard-cache";

const id = "504koqyhKoo";
const data = {v:1,videoId:id,fetchedAt:"2026-10-05T16:00:00Z",durationSeconds:947,
  spec:`https://i.ytimg.com/sb/${id}/storyboard3_L$L/$N.jpg|320#180#96#3#3#10000#M$M#public-fixture`};
test("public cache preserves chronological frames and supports both metadata representations", () => {
  const frames = readStoryboardCache(data,id);
  expect(frames).toHaveLength(24);
  expect(frames.at(-1)?.timeSeconds).toBe(940);
  expect(readStoryboardCache({...data,spec:undefined,frames},id)).toEqual(frames);
  expect(storyboardCacheKey(id)).toBe("youtube-storyboards/v1/504koqyhKoo.json");
});
test("cache cannot substitute another video, external image URLs or malformed sprite tiles", () => {
  const frames=readStoryboardCache(data,id);
  for (const invalid of [{...data,videoId:"abcdefghijk"},{...data,fetchedAt:"not a date"},
    {...data,spec:undefined,frames:[{...frames[0],url:"https://evil.test/secret"}]},
    {...data,spec:undefined,frames:[{...frames[0],row:99}]},
    {...data,spec:undefined,frames:[{...frames[0],timeSeconds:948}]},
    {...data,spec:undefined,frames:[frames[1],frames[0]]}]) expect(readStoryboardCache(invalid,id)).toEqual([]);
  expect(readStoryboardCache(data,"../localhost")).toEqual([]);
});
