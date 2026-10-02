import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { addAssetFolders, createAsset, internalDeleteAsset } from "../convex/assets";
import { createFolder } from "../convex/folders";
import { getOrCreateTags } from "../convex/tags";
import {
  getBookmarkForSave,
  listBookmarks,
  updateBookmarkNote,
  upsertBookmarkRecord,
} from "../convex/bookmarks";
import {
  normalizeCapturedXPost,
  saveXPostFromExtension,
} from "../convex/bookmarkSaves";
import {
  buildBookmarkSearchText,
  buildXPostTitle,
  parseXPostUrl,
  toOriginalXImageUrl,
} from "../convex/bookmarkHelpers";
import {
  bookmarkCardLayout,
  filterBookmarkEntries,
  formatBookmarkCount,
  formatBookmarkDate,
  type BookmarkPost,
} from "../lib/bookmarks";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

const OWNER = "278674008";
const ONE_BY_ONE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4////fwAJ+wP92PZgeAAAAABJRU5ErkJggg==";

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
        default:
          throw new Error(`Unknown mutation reference: ${getFunctionName(reference)}`);
      }
    },
    runQuery: async (reference: object, args: unknown) => {
      switch (getFunctionName(reference)) {
        case "bookmarks:getBookmarkForSave":
          return await callAsOwner(getBookmarkForSave)(inner as never, args as never);
        default:
          throw new Error(`Unknown query reference: ${getFunctionName(reference)}`);
      }
    },
  };
  return { ...harness, ctx };
};

describe("X post URL helpers", () => {
  test("parses permalinks from x.com and twitter.com into a canonical url", () => {
    expect(parseXPostUrl("https://twitter.com/Laniameda/status/1840000000000000001/photo/1?s=20")).toEqual({
      externalId: "1840000000000000001",
      authorHandle: "Laniameda",
      url: "https://x.com/Laniameda/status/1840000000000000001",
    });
    expect(parseXPostUrl("https://x.com/i/web/status/1840000000000000001")?.url).toBe(
      "https://x.com/i/web/status/1840000000000000001",
    );
    expect(parseXPostUrl("https://x.com/home")).toBeNull();
    expect(parseXPostUrl("https://example.com/a/status/1840000000000000001")).toBeNull();
    expect(parseXPostUrl("not a url")).toBeNull();
  });

  test("asks pbs.twimg.com for the original image", () => {
    expect(
      toOriginalXImageUrl("https://pbs.twimg.com/media/GabcDEF?format=jpg&name=small"),
    ).toBe("https://pbs.twimg.com/media/GabcDEF?format=jpg&name=orig");
    expect(toOriginalXImageUrl("https://example.com/a.jpg")).toBe("https://example.com/a.jpg");
  });

  test("builds a title and search text from the post", () => {
    expect(buildXPostTitle({ authorHandle: "mb", text: "hello\n  world" })).toBe("@mb: hello world");
    const text = buildBookmarkSearchText({
      authorName: "Misha",
      authorHandle: "mb",
      text: "Seedance tips",
      quotedPost: { authorHandle: "other", text: "original" },
      userNote: "use for cars",
    });
    expect(text).toContain("post by Misha @mb on X");
    expect(text).toContain("Seedance tips");
    expect(text).toContain("quoting @other: original");
    expect(text).toContain("note: use for cars");
  });
});

describe("normalizeCapturedXPost", () => {
  test("canonicalizes the url, drops unusable media and empty metrics", () => {
    const post = normalizeCapturedXPost({
      url: "https://twitter.com/someone/status/1840000000000000002?s=46",
      authorHandle: "@Someone",
      authorAvatarUrl: "javascript:alert(1)",
      text: "  a post  ",
      media: [
        { kind: "image", url: "https://pbs.twimg.com/media/AAA?format=jpg&name=small" },
        { kind: "image", url: "blob:https://x.com/123" },
      ],
      metrics: {},
    });
    expect(post.url).toBe("https://x.com/Someone/status/1840000000000000002");
    expect(post.externalId).toBe("1840000000000000002");
    expect(post.authorAvatarUrl).toBeUndefined();
    expect(post.text).toBe("a post");
    expect(post.media).toEqual([
      {
        kind: "image",
        url: "https://pbs.twimg.com/media/AAA?format=jpg&name=orig",
        width: undefined,
        height: undefined,
        alt: undefined,
      },
    ]);
    expect(post.metrics).toBeUndefined();
  });

  test("rejects non-post urls", () => {
    expect(() => normalizeCapturedXPost({ url: "https://x.com/explore" })).toThrow();
  });
});

describe("saveXPostFromExtension", () => {
  let harness: ReturnType<typeof createActionHarness>;
  let originalFetch: typeof globalThis.fetch;
  let originalR2PublicBaseUrl: string | undefined;

  beforeEach(() => {
    harness = createActionHarness();
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

  const createCollection = async (name: string) =>
    (
      (await callAsOwner(createFolder)(harness.ctx as never, {
        ownerUserId: OWNER,
        name,
      })) as { folderId: string }
    ).folderId;

  test("a text post saves a bookmark with its screenshot preview, filed into the collection", async () => {
    const carsId = await createCollection("Cars");

    const result = await callAsOwner(saveXPostFromExtension)(harness.ctx as never, {
      ownerUserId: OWNER,
      post: {
        url: "https://x.com/carguy/status/1840000000000000003",
        authorName: "Car Guy",
        authorHandle: "carguy",
        text: "The best rear three-quarter angle is 35mm at hip height.",
        postedAt: Date.UTC(2026, 8, 30),
        metrics: { likes: 1200, reposts: 40 },
      },
      preview: { base64: ONE_BY_ONE_PNG, contentType: "image/png" },
      folderIds: [carsId],
      userNote: "angle reference",
    });

    expect(result.created).toBeTrue();
    const asset = await harness.db.get<Record<string, unknown>>(result.assetId);
    expect(asset?.assetRole).toBe("bookmark");
    expect(asset?.bookmarkId).toBe(result.bookmarkId);
    expect(asset?.sourceUrl).toBe("https://x.com/carguy/status/1840000000000000003");
    expect(asset?.ingestKey).toBe("x-post:1840000000000000003");

    const links = harness.db.getTableDocs("assetFolders") as Array<{ folderId: string }>;
    expect(links.map((link) => link.folderId)).toEqual([carsId]);

    const bookmark = await harness.db.get<Record<string, unknown>>(result.bookmarkId);
    expect(bookmark?.text).toBe("The best rear three-quarter angle is 35mm at hip height.");
    expect(bookmark?.userNote).toBe("angle reference");
    expect(bookmark?.metrics).toEqual({
      replies: undefined,
      reposts: 40,
      likes: 1200,
      bookmarks: undefined,
      views: undefined,
    });

    const tags = harness.db.getTableDocs("tags") as Array<{ name: string }>;
    expect(tags.map((tag) => tag.name).sort()).toEqual(["bookmark", "x"]);
  });

  test("re-saving the same post updates it and adds the new collection without a second asset", async () => {
    const carsId = await createCollection("Cars");
    const refsId = await createCollection("References");
    const post = {
      url: "https://x.com/carguy/status/1840000000000000004",
      authorHandle: "carguy",
      text: "first",
    };

    const first = await callAsOwner(saveXPostFromExtension)(harness.ctx as never, {
      ownerUserId: OWNER,
      post,
      preview: { base64: ONE_BY_ONE_PNG, contentType: "image/png" },
      folderIds: [carsId],
      userNote: "keep",
    });
    const second = await callAsOwner(saveXPostFromExtension)(harness.ctx as never, {
      ownerUserId: OWNER,
      post: { ...post, url: "https://twitter.com/carguy/status/1840000000000000004?s=20", text: "edited" },
      folderIds: [refsId],
    });

    expect(second.created).toBeFalse();
    expect(second.assetId).toBe(first.assetId);
    expect(second.bookmarkId).toBe(first.bookmarkId);
    expect(harness.db.getTableDocs("assets")).toHaveLength(1);
    expect(harness.db.getTableDocs("bookmarks")).toHaveLength(1);

    const bookmark = await harness.db.get<Record<string, unknown>>(first.bookmarkId);
    expect(bookmark?.text).toBe("edited");
    // A re-save without a note keeps the earlier one.
    expect(bookmark?.userNote).toBe("keep");

    const folderIds = (harness.db.getTableDocs("assetFolders") as Array<{ folderId: string }>)
      .map((link) => link.folderId)
      .sort();
    expect(folderIds).toEqual([carsId, refsId].sort());
  });

  test("a media post without a preview fetches its first image", async () => {
    const fetched: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      return new Response(Buffer.from(ONE_BY_ONE_PNG, "base64"), {
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch;

    const result = await callAsOwner(saveXPostFromExtension)(harness.ctx as never, {
      ownerUserId: OWNER,
      post: {
        url: "https://x.com/carguy/status/1840000000000000005",
        media: [{ kind: "image", url: "https://pbs.twimg.com/media/BBB?format=jpg&name=small" }],
      },
    });

    expect(result.created).toBeTrue();
    expect(fetched).toEqual(["https://pbs.twimg.com/media/BBB?format=jpg&name=orig"]);
  });

  test("a text post without a preview is refused", async () => {
    await expect(
      callAsOwner(saveXPostFromExtension)(harness.ctx as never, {
        ownerUserId: OWNER,
        post: { url: "https://x.com/carguy/status/1840000000000000006", text: "no picture" },
      }),
    ).rejects.toThrow(/preview/i);
    expect(harness.db.getTableDocs("assets")).toHaveLength(0);
  });

  test("listBookmarks returns bookmark-backed gallery results, narrowed by collection", async () => {
    const carsId = await createCollection("Cars");
    const inCars = await callAsOwner(saveXPostFromExtension)(harness.ctx as never, {
      ownerUserId: OWNER,
      post: { url: "https://x.com/a/status/1840000000000000007", text: "car post" },
      preview: { base64: ONE_BY_ONE_PNG, contentType: "image/png" },
      folderIds: [carsId],
    });
    await callAsOwner(saveXPostFromExtension)(harness.ctx as never, {
      ownerUserId: OWNER,
      post: { url: "https://x.com/b/status/1840000000000000008", text: "other post" },
      preview: { base64: ONE_BY_ONE_PNG, contentType: "image/png" },
    });

    const all = await callAsOwner(listBookmarks)(harness.ctx as never, { ownerUserId: OWNER });
    expect(all).toHaveLength(2);
    expect(all.every((row: { bookmark?: unknown }) => Boolean(row.bookmark))).toBeTrue();

    const cars = await callAsOwner(listBookmarks)(harness.ctx as never, {
      ownerUserId: OWNER,
      folderId: carsId,
    });
    expect(cars.map((row: { _id: string }) => row._id)).toEqual([inCars.assetId]);
    expect(cars[0].bookmark.text).toBe("car post");
  });

  test("deleting the preview asset deletes the bookmark", async () => {
    const result = await callAsOwner(saveXPostFromExtension)(harness.ctx as never, {
      ownerUserId: OWNER,
      post: { url: "https://x.com/a/status/1840000000000000009", text: "bye" },
      preview: { base64: ONE_BY_ONE_PNG, contentType: "image/png" },
    });
    // R2 blob deletes run through the component; the mock just accepts them.
    await callAsOwner(internalDeleteAsset)(
      { ...harness.ctx, runMutation: async () => null } as never,
      { id: result.assetId },
    );
    expect(harness.db.getTableDocs("bookmarks")).toHaveLength(0);
  });

  test("updateBookmarkNote edits the owner's note only", async () => {
    const result = await callAsOwner(saveXPostFromExtension)(harness.ctx as never, {
      ownerUserId: OWNER,
      post: { url: "https://x.com/a/status/1840000000000000010", text: "note me" },
      preview: { base64: ONE_BY_ONE_PNG, contentType: "image/png" },
    });
    await callAsOwner(updateBookmarkNote)(harness.ctx as never, {
      ownerUserId: OWNER,
      bookmarkId: result.bookmarkId,
      userNote: "  for the cars deck  ",
    });
    const bookmark = await harness.db.get<Record<string, unknown>>(result.bookmarkId);
    expect(bookmark?.userNote).toBe("for the cars deck");
    expect(bookmark?.text).toBe("note me");

    await expect(
      callAsOwner(updateBookmarkNote)(harness.ctx as never, {
        ownerUserId: "someone-else",
        bookmarkId: result.bookmarkId,
        userNote: "hijack",
      }),
    ).rejects.toThrow();
  });
});

describe("bookmark card helpers", () => {
  const post = (overrides: Partial<BookmarkPost> = {}): BookmarkPost => ({
    _id: "b1",
    platform: "x",
    externalId: "1",
    url: "https://x.com/a/status/1",
    media: [],
    savedAt: 0,
    ...overrides,
  });

  test("formats counts and dates like X", () => {
    expect(formatBookmarkCount(999)).toBe("999");
    expect(formatBookmarkCount(1234)).toBe("1.2K");
    expect(formatBookmarkCount(12_345)).toBe("12K");
    expect(formatBookmarkCount(3_400_000)).toBe("3.4M");
    expect(formatBookmarkCount(undefined)).toBeUndefined();
    expect(formatBookmarkDate(Date.UTC(2026, 9, 1, 12))).toBe("Oct 1, 2026");
  });

  test("text posts grow with their text; media posts add chrome to the media", () => {
    const short = bookmarkCardLayout({ post: post({ text: "hi" }) });
    const long = bookmarkCardLayout({ post: post({ text: "x".repeat(400) }) });
    expect(long.height).toBeGreaterThan(short.height);
    const media = bookmarkCardLayout({
      post: post({ media: [{ kind: "image", url: "https://pbs.twimg.com/media/a" }] }),
      previewWidth: 1000,
      previewHeight: 1000,
    });
    expect(media.height).toBeGreaterThan(1000);
    // Inside the grid's 0.45–2.4 aspect clamp.
    for (const layout of [short, long, media]) {
      expect(layout.width / layout.height).toBeGreaterThanOrEqual(0.45);
    }
  });

  test("filters entries by collection scope and every query word", () => {
    const entries = [
      { id: "1", folderIds: ["cars"], bookmark: post({ authorHandle: "carguy", text: "Porsche 911 angles" }) },
      { id: "2", folderIds: ["refs"], bookmark: post({ authorName: "Misha", text: "lighting setup", userNote: "porsche" }) },
      { id: "3", folderIds: ["cars"] },
    ];
    expect(filterBookmarkEntries(entries, { folderIds: null, query: "" }).map((e) => e.id)).toEqual(["1", "2"]);
    expect(filterBookmarkEntries(entries, { folderIds: new Set(["cars"]), query: "" }).map((e) => e.id)).toEqual(["1"]);
    expect(filterBookmarkEntries(entries, { folderIds: null, query: "porsche" }).map((e) => e.id)).toEqual(["1", "2"]);
    expect(filterBookmarkEntries(entries, { folderIds: null, query: "@carguy 911" }).map((e) => e.id)).toEqual(["1"]);
  });
});
