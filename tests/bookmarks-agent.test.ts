import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { addAssetFolders, createAsset, internalDeleteAsset } from "../convex/assets";
import { getOrCreateTags } from "../convex/tags";
import {
  findAssetsForXPost,
  getBookmarkForSave,
  linkAssetsToBookmark,
  listBookmarkPosts,
  upsertBookmarkRecord,
} from "../convex/bookmarks";
import { saveXPostFromAgent } from "../convex/bookmarkSaves";
import {
  mergeXPostCapture,
  xPostFromFxTwitter,
  xPostFromSyndication,
} from "../convex/bookmarkHelpers";
import { buildGalleryEntries } from "../lib/gallery-entries";
import type { BookmarkPost } from "../lib/bookmarks";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

const OWNER = "278674008";
const ONE_BY_ONE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4////fwAJ+wP92PZgeAAAAABJRU5ErkJggg==";

const FX_VIDEO_POST = {
  code: 200,
  tweet: {
    id: "2106015208221393339",
    url: "https://x.com/ltx_io/status/2106015208221393339",
    text: "The last drop of VFX Week: Alpha Gen (Beta).",
    lang: "en",
    created_timestamp: 1790948128,
    replies: 59,
    retweets: 216,
    likes: 2172,
    bookmarks: 2348,
    views: 855483,
    author: {
      name: "LTX.io",
      screen_name: "ltx_io",
      avatar_url: "https://pbs.twimg.com/profile_images/1/abc_normal.jpg",
      verification: { verified: true },
    },
    media: {
      all: [
        {
          type: "video",
          url: "https://video.twimg.com/amplify_video/1/vid/a.mp4",
          thumbnail_url: "https://pbs.twimg.com/amplify_video_thumb/1/img/poster.jpg",
          width: 1920,
          height: 1080,
        },
      ],
    },
  },
};

const getFunctionName = (reference: object) => {
  const [symbol] = Object.getOwnPropertySymbols(reference);
  return symbol
    ? ((reference as Record<PropertyKey, string | undefined>)[symbol] ?? "")
    : "";
};

const createActionHarness = () => {
  const harness = createMockConvexMutationCtx();
  const inner = harness.ctx;
  const ctx = {
    ...harness.ctx,
    runMutation: async (reference: object, args: unknown) => {
      switch (getFunctionName(reference)) {
        case "assets:createAsset":
          return await callAsOwner(createAsset)(inner as never, args as never);
        case "assets:addAssetFolders":
          return await callAsOwner(addAssetFolders)(inner as never, args as never);
        case "assets:internalDeleteAsset":
          return await callAsOwner(internalDeleteAsset)(inner as never, args as never);
        case "tags:getOrCreateTags":
          return await callAsOwner(getOrCreateTags)(inner as never, args as never);
        case "bookmarks:upsertBookmarkRecord":
          return await callAsOwner(upsertBookmarkRecord)(inner as never, args as never);
        case "bookmarks:linkAssetsToBookmark":
          return await callAsOwner(linkAssetsToBookmark)(inner as never, args as never);
        default:
          throw new Error(`Unknown mutation reference: ${getFunctionName(reference)}`);
      }
    },
    runQuery: async (reference: object, args: unknown) => {
      switch (getFunctionName(reference)) {
        case "bookmarks:getBookmarkForSave":
          return await callAsOwner(getBookmarkForSave)(inner as never, args as never);
        case "bookmarks:findAssetsForXPost":
          return await callAsOwner(findAssetsForXPost)(inner as never, args as never);
        default:
          throw new Error(`Unknown query reference: ${getFunctionName(reference)}`);
      }
    },
  };
  return { ...harness, ctx };
};

describe("reading a post from the public endpoints", () => {
  test("maps the mirror's payload: author, text, video poster, counts", () => {
    const post = xPostFromFxTwitter(FX_VIDEO_POST);
    expect(post).toMatchObject({
      url: "https://x.com/ltx_io/status/2106015208221393339",
      externalId: "2106015208221393339",
      authorName: "LTX.io",
      authorHandle: "ltx_io",
      authorVerified: true,
      authorAvatarUrl: "https://pbs.twimg.com/profile_images/1/abc_400x400.jpg",
      text: "The last drop of VFX Week: Alpha Gen (Beta).",
      postedAt: 1790948128000,
      metrics: { replies: 59, reposts: 216, likes: 2172, bookmarks: 2348, views: 855483 },
    });
    // A video is kept as its poster frame.
    expect(post?.media).toEqual([
      {
        kind: "video",
        url: "https://pbs.twimg.com/amplify_video_thumb/1/img/poster.jpg",
        width: 1920,
        height: 1080,
        alt: undefined,
      },
    ]);
  });

  test("a quote post with no picture of its own takes the quoted post's", () => {
    const post = xPostFromFxTwitter({
      tweet: {
        id: "1840000000000000100",
        text: "this",
        author: { screen_name: "quoter" },
        quote: {
          url: "https://x.com/maker/status/1840000000000000099",
          text: "the original",
          author: { name: "Maker", screen_name: "maker" },
          media: { all: [{ type: "photo", url: "https://pbs.twimg.com/media/Q.jpg" }] },
        },
      },
    });
    expect(post?.media?.[0]).toMatchObject({ kind: "image", url: "https://pbs.twimg.com/media/Q.jpg" });
    expect(post?.quotedPost).toEqual({
      url: "https://x.com/maker/status/1840000000000000099",
      authorName: "Maker",
      authorHandle: "maker",
      text: "the original",
    });
  });

  test("maps the embed payload and drops the trailing media link from the text", () => {
    const post = xPostFromSyndication({
      __typename: "Tweet",
      id_str: "1840000000000000101",
      text: "Look at this https://t.co/abc",
      display_text_range: [0, 12],
      lang: "en",
      created_at: "2026-10-02T13:35:28.000Z",
      favorite_count: 12,
      conversation_count: 3,
      user: { name: "Maker", screen_name: "maker", is_blue_verified: true },
      mediaDetails: [
        {
          type: "photo",
          media_url_https: "https://pbs.twimg.com/media/S.jpg",
          original_info: { width: 800, height: 600 },
        },
      ],
    });
    expect(post).toMatchObject({
      url: "https://x.com/maker/status/1840000000000000101",
      text: "Look at this",
      authorVerified: true,
      postedAt: Date.UTC(2026, 9, 2, 13, 35, 28),
      metrics: { replies: 3, likes: 12 },
    });
    expect(post?.media).toHaveLength(1);
  });

  test("an unreadable payload maps to null; supplied fields win over fetched ones", () => {
    expect(xPostFromFxTwitter({ code: 404, message: "NOT_FOUND" })).toBeNull();
    expect(xPostFromSyndication({ __typename: "TweetTombstone" })).toBeNull();
    const merged = mergeXPostCapture(
      { url: "https://x.com/a/status/1840000000000000102", text: "fetched", lang: "en" },
      { text: "supplied", lang: "", media: [] },
      "https://x.com/a/status/1840000000000000102",
    );
    expect(merged.text).toBe("supplied");
    expect(merged.lang).toBe("en");
  });
});

describe("saveXPostFromAgent", () => {
  let harness: ReturnType<typeof createActionHarness>;
  let originalFetch: typeof globalThis.fetch;
  let originalR2PublicBaseUrl: string | undefined;
  let fetched: string[];

  // The mirror answers with `payload`; every other URL is an image.
  const stubFetch = (payload: unknown | null) => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      if (url.includes("api.fxtwitter.com") || url.includes("cdn.syndication.twimg.com")) {
        return payload && url.includes("api.fxtwitter.com")
          ? new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } })
          : new Response("{}", { status: 404 });
      }
      return new Response(Buffer.from(ONE_BY_ONE_PNG, "base64"), {
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch;
  };

  beforeEach(() => {
    harness = createActionHarness();
    fetched = [];
    originalFetch = globalThis.fetch;
    originalR2PublicBaseUrl = process.env.R2_PUBLIC_BASE_URL;
    process.env.R2_PUBLIC_BASE_URL = "https://r2.test";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalR2PublicBaseUrl === undefined) {
      delete process.env.R2_PUBLIC_BASE_URL;
    } else {
      process.env.R2_PUBLIC_BASE_URL = originalR2PublicBaseUrl;
    }
  });

  const createMediaAsset = async (sourceUrl: string, ingestKey: string) => {
    const tagIds = await callAsOwner(getOrCreateTags)(harness.ctx as never, {
      names: ["x", "inspiration"],
    });
    const created = (await callAsOwner(createAsset)(harness.ctx as never, {
      ownerUserId: OWNER,
      kind: "image",
      r2Key: `media/${ingestKey}`,
      sourceUrl,
      tagIds,
      ingestKey,
      assetRole: "inspiration_capture",
      ingestSource: "agent",
    })) as { assetId: string };
    return created.assetId;
  };

  test("a link alone saves the post: text, author, a post card with the video's poster", async () => {
    stubFetch(FX_VIDEO_POST);

    const result = await callAsOwner(saveXPostFromAgent)(harness.ctx as never, {
      ownerUserId: OWNER,
      url: "https://x.com/ltx_io/status/2106015208221393339?s=20",
      agentDescription: "LTX announces Alpha Gen. By @ltx_io.",
    });

    expect(result).toMatchObject({
      created: true,
      fetched: true,
      url: "https://x.com/ltx_io/status/2106015208221393339",
      authorHandle: "ltx_io",
      linkedAssetIds: [],
    });
    expect(fetched).toContain("https://pbs.twimg.com/amplify_video_thumb/1/img/poster.jpg");

    const asset = await harness.db.get<Record<string, unknown>>(result.assetId);
    expect(asset).toMatchObject({
      assetRole: "bookmark",
      ingestSource: "agent",
      bookmarkId: result.bookmarkId,
      agentDescription: "LTX announces Alpha Gen. By @ltx_io.",
      ingestKey: "x-post:2106015208221393339",
    });
    const bookmark = await harness.db.get<Record<string, unknown>>(result.bookmarkId);
    expect(bookmark?.text).toBe("The last drop of VFX Week: Alpha Gen (Beta).");
    expect(bookmark?.authorName).toBe("LTX.io");
  });

  test("a post whose images are already saved is linked to them, not copied", async () => {
    const url = "https://x.com/ltx_io/status/2106015208221393339";
    const first = await createMediaAsset(url, "x:2106015208221393339:1");
    const second = await createMediaAsset(url, "x:2106015208221393339:2");
    stubFetch(FX_VIDEO_POST);

    const result = await callAsOwner(saveXPostFromAgent)(harness.ctx as never, {
      ownerUserId: OWNER,
      url,
    });

    expect(result.assetId).toBe(first);
    expect(result.linkedAssetIds).toEqual([first, second]);
    expect(harness.db.getTableDocs("assets")).toHaveLength(2);
    expect(harness.db.getTableDocs("bookmarks")).toHaveLength(1);

    const tags = harness.db.getTableDocs("tags") as Array<{ _id: string; name: string }>;
    const bookmarkTag = tags.find((tag) => tag.name === "bookmark");
    for (const assetId of [first, second]) {
      const asset = await harness.db.get<Record<string, unknown>>(assetId);
      // The piece keeps its role and gains the post and the tag.
      expect(asset?.assetRole).toBe("inspiration_capture");
      expect(asset?.bookmarkId).toBe(result.bookmarkId);
      expect(asset?.tagIds as string[]).toContain(bookmarkTag!._id);
    }
    // Tag filters and their counts read the join rows.
    const links = harness.db.getTableDocs("assetTags") as Array<{ tagId: string }>;
    expect(links.filter((link) => link.tagId === bookmarkTag!._id)).toHaveLength(2);

    // A second save changes nothing but the refreshed post.
    const again = await callAsOwner(saveXPostFromAgent)(harness.ctx as never, {
      ownerUserId: OWNER,
      url,
    });
    expect(again.created).toBeFalse();
    expect(harness.db.getTableDocs("assets")).toHaveLength(2);
    expect(
      (harness.db.getTableDocs("assetTags") as Array<{ tagId: string }>).filter(
        (link) => link.tagId === bookmarkTag!._id,
      ),
    ).toHaveLength(2);
  });

  test("deleting the piece a post points at hands the post to its sibling", async () => {
    const url = "https://x.com/ltx_io/status/2106015208221393339";
    const first = await createMediaAsset(url, "x:2106015208221393339:1");
    const second = await createMediaAsset(url, "x:2106015208221393339:2");
    stubFetch(FX_VIDEO_POST);
    const result = await callAsOwner(saveXPostFromAgent)(harness.ctx as never, {
      ownerUserId: OWNER,
      url,
    });

    const deleteCtx = { ...harness.ctx, runMutation: async () => null };
    await callAsOwner(internalDeleteAsset)(deleteCtx as never, { id: first });
    const bookmark = await harness.db.get<Record<string, unknown>>(result.bookmarkId);
    expect(bookmark?.assetId).toBe(second);

    await callAsOwner(internalDeleteAsset)(deleteCtx as never, { id: second });
    expect(harness.db.getTableDocs("bookmarks")).toHaveLength(0);
  });

  test("a text post stores the author's avatar and renders from its text", async () => {
    stubFetch({
      tweet: {
        id: "1840000000000000200",
        text: "No picture, just a thought about lenses.",
        author: {
          name: "Lens Person",
          screen_name: "lensperson",
          avatar_url: "https://pbs.twimg.com/profile_images/2/me_normal.jpg",
        },
      },
    });

    const result = await callAsOwner(saveXPostFromAgent)(harness.ctx as never, {
      ownerUserId: OWNER,
      url: "https://x.com/lensperson/status/1840000000000000200",
    });

    expect(fetched).toContain("https://pbs.twimg.com/profile_images/2/me_400x400.jpg");
    const bookmark = await harness.db.get<Record<string, unknown>>(result.bookmarkId);
    expect(bookmark?.media).toEqual([]);
    expect(bookmark?.text).toBe("No picture, just a thought about lenses.");
  });

  test("an unreadable post is refused unless the caller sends its text", async () => {
    stubFetch(null);
    const url = "https://x.com/gone/status/1840000000000000201";
    await expect(
      callAsOwner(saveXPostFromAgent)(harness.ctx as never, { ownerUserId: OWNER, url }),
    ).rejects.toThrow(/could not be read/i);

    const result = await callAsOwner(saveXPostFromAgent)(harness.ctx as never, {
      ownerUserId: OWNER,
      url,
      post: { text: "copied by hand", authorName: "Gone" },
      preview: { base64: ONE_BY_ONE_PNG, contentType: "image/png" },
    });
    expect(result.fetched).toBeFalse();
    expect(result.text).toBe("copied by hand");
  });

  test("listBookmarkPosts reads posts as text and matches every search word", async () => {
    stubFetch(FX_VIDEO_POST);
    const saved = await callAsOwner(saveXPostFromAgent)(harness.ctx as never, {
      ownerUserId: OWNER,
      url: "https://x.com/ltx_io/status/2106015208221393339",
      userNote: "try on the dog plate",
    });

    const hit = await callAsOwner(listBookmarkPosts)(harness.ctx as never, {
      ownerUserId: OWNER,
      search: "alpha DOG",
    });
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({
      id: `bookmark:${saved.bookmarkId}`,
      authorHandle: "ltx_io",
      userNote: "try on the dog plate",
      assetIds: [`asset:${saved.assetId}`],
    });

    expect(
      await callAsOwner(listBookmarkPosts)(harness.ctx as never, {
        ownerUserId: OWNER,
        search: "alpha cat",
      }),
    ).toHaveLength(0);
    expect(
      await callAsOwner(listBookmarkPosts)(harness.ctx as never, {
        ownerUserId: OWNER,
        authorHandle: "@LTX_io",
      }),
    ).toHaveLength(1);
  });
});

describe("post cards in the grid", () => {
  const post: BookmarkPost = {
    _id: "bookmark:1",
    platform: "x",
    externalId: "1",
    url: "https://x.com/a/status/1",
    text: "hello",
    media: [],
    savedAt: 1,
  };

  test("a post's own preview is a post card; a linked media piece stays a media tile", () => {
    const entries = buildGalleryEntries({
      assets: [
        { _id: "asset:preview", createdAt: 2, assetRole: "bookmark", bookmark: post },
        { _id: "asset:media", createdAt: 1, assetRole: "inspiration_capture", bookmark: post },
      ],
      sortOrder: "newest",
    });
    expect(entries.map((entry) => [entry.id, entry.postCard])).toEqual([
      ["asset:preview", true],
      ["asset:media", false],
    ]);
    // Both still carry the post, for the detail panel and search.
    expect(entries.every((entry) => entry.bookmark?.text === "hello")).toBeTrue();
  });
});
