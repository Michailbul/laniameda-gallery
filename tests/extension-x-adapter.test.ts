import { beforeAll, describe, expect, test } from "bun:test";
import { h } from "./helpers/mini-dom";

type XPost = {
  url: string;
  externalId: string;
  authorName?: string;
  authorHandle?: string;
  authorAvatarUrl?: string;
  authorVerified?: boolean;
  text?: string;
  lang?: string;
  postedAt?: number;
  media: Array<{ kind: string; url: string; alt?: string }>;
  quotedPost?: { url?: string; authorName?: string; authorHandle?: string; text?: string };
  metrics?: Record<string, number>;
};

type XAdapterApi = {
  isXPage: (hostname?: string) => boolean;
  parseStatusUrl: (href: string, base?: string) => { handle: string; statusId: string; url: string } | null;
  parseCount: (value: string) => number | undefined;
  parseMetricsLabel: (label: string) => Record<string, number> | undefined;
  toOriginalMediaUrl: (src: string) => string;
  toLargeAvatarUrl: (src: string) => string;
  readRichText: (el: unknown) => string;
  getActionBar: (article: unknown) => unknown;
  extractPost: (article: unknown, locationHref?: string) => XPost | null;
};

const getApi = () =>
  (globalThis as typeof globalThis & { SaveToGalleryX: XAdapterApi }).SaveToGalleryX;

beforeAll(async () => {
  await import("../extension/x-adapter.js");
});

const userName = (name: string, handle: string, verified = false) =>
  h(
    "div",
    { "data-testid": "User-Name" },
    h("a", { href: `/${handle}` }, h("span", {}, name), ...(verified ? [h("svg", { "data-testid": "icon-verified" })] : [])),
    h("a", { href: `/${handle}` }, h("span", {}, `@${handle}`)),
  );

const buildPost = ({ withQuote = false, withPhotos = true } = {}) => {
  const actionBar = h("div", {
    role: "group",
    "aria-label": "12 replies, 1.2K reposts, 5,600 likes, 30 bookmarks, 120K views",
  });
  const quote = withQuote
    ? h(
        "div",
        { role: "link", tabindex: "0" },
        userName("Quoted Person", "quoted"),
        h("a", { href: "/quoted/status/1799999999999999999" }, h("time", { datetime: "2026-01-01T00:00:00.000Z" })),
        h("div", { "data-testid": "tweetText" }, "the original take"),
        h("div", { "data-testid": "tweetPhoto" }, h("img", { src: "https://pbs.twimg.com/media/QUOTED?format=jpg&name=small" })),
      )
    : null;
  const article = h(
    "article",
    { "data-testid": "tweet" },
    h("div", { "data-testid": "Tweet-User-Avatar" }, h("img", { src: "https://pbs.twimg.com/profile_images/1/abc_normal.jpg" })),
    userName("Car Guy", "carguy", true),
    h("a", { href: "/carguy/status/1840000000000000001" }, h("time", { datetime: "2026-09-30T10:00:00.000Z" })),
    h(
      "div",
      { "data-testid": "tweetText", lang: "en" },
      h("span", {}, "Golden hour on the 911 "),
      h("img", { alt: "🔥" }),
      h("br"),
      h("span", {}, "35mm, f/2"),
    ),
    ...(withPhotos
      ? [
          h("div", { "data-testid": "tweetPhoto" }, h("img", { src: "https://pbs.twimg.com/media/AAA?format=jpg&name=small", alt: "A silver 911" })),
          h("div", { "data-testid": "tweetPhoto" }, h("img", { src: "https://pbs.twimg.com/media/BBB?format=png&name=360x360" })),
        ]
      : []),
    ...(quote ? [quote] : []),
    actionBar,
  );
  return { article, actionBar };
};

describe("X adapter helpers", () => {
  test("recognizes x.com and twitter.com hosts only", () => {
    const api = getApi();
    expect(api.isXPage("x.com")).toBeTrue();
    expect(api.isXPage("www.twitter.com")).toBeTrue();
    expect(api.isXPage("mobile.x.com")).toBeTrue();
    expect(api.isXPage("notx.com")).toBeFalse();
    expect(api.isXPage("x.company.com")).toBeFalse();
  });

  test("parses status permalinks, relative or absolute", () => {
    const api = getApi();
    expect(api.parseStatusUrl("/carguy/status/1840000000000000001/photo/1")).toEqual({
      handle: "carguy",
      statusId: "1840000000000000001",
      url: "https://x.com/carguy/status/1840000000000000001",
    });
    expect(api.parseStatusUrl("https://twitter.com/i/status/1840000000000000001")?.url).toBe(
      "https://x.com/i/web/status/1840000000000000001",
    );
    expect(api.parseStatusUrl("/carguy")).toBeNull();
  });

  test("parses abbreviated counts and the action bar label", () => {
    const api = getApi();
    expect(api.parseCount("1.2K")).toBe(1200);
    expect(api.parseCount("5,600")).toBe(5600);
    expect(api.parseCount("2M")).toBe(2_000_000);
    expect(api.parseCount("abc")).toBeUndefined();
    expect(api.parseMetricsLabel("1 reply, 3 reposts, 1 like, 7 views")).toEqual({
      replies: 1,
      reposts: 3,
      likes: 1,
      views: 7,
    });
    expect(api.parseMetricsLabel("")).toBeUndefined();
  });

  test("upgrades media and avatar urls", () => {
    const api = getApi();
    expect(api.toOriginalMediaUrl("https://pbs.twimg.com/media/AAA?format=jpg&name=small")).toBe(
      "https://pbs.twimg.com/media/AAA?format=jpg&name=orig",
    );
    expect(api.toLargeAvatarUrl("https://pbs.twimg.com/profile_images/1/abc_normal.jpg")).toBe(
      "https://pbs.twimg.com/profile_images/1/abc_400x400.jpg",
    );
  });
});

describe("X adapter extractPost", () => {
  test("reads author, text with emoji and line breaks, time, photos and counts", () => {
    const { article } = buildPost();
    const post = getApi().extractPost(article, "https://x.com/home")!;
    expect(post.url).toBe("https://x.com/carguy/status/1840000000000000001");
    expect(post.externalId).toBe("1840000000000000001");
    expect(post.authorName).toBe("Car Guy");
    expect(post.authorHandle).toBe("carguy");
    expect(post.authorVerified).toBeTrue();
    expect(post.authorAvatarUrl).toBe("https://pbs.twimg.com/profile_images/1/abc_400x400.jpg");
    expect(post.text).toBe("Golden hour on the 911 🔥\n35mm, f/2");
    expect(post.lang).toBe("en");
    expect(post.postedAt).toBe(Date.parse("2026-09-30T10:00:00.000Z"));
    expect(post.media.map((media) => media.url)).toEqual([
      "https://pbs.twimg.com/media/AAA?format=jpg&name=orig",
      "https://pbs.twimg.com/media/BBB?format=png&name=orig",
    ]);
    expect(post.media[0]!.alt).toBe("A silver 911");
    expect(post.metrics).toEqual({
      replies: 12,
      reposts: 1200,
      likes: 5600,
      bookmarks: 30,
      views: 120_000,
    });
  });

  test("keeps the quoted post separate from the post's own text and media", () => {
    const { article, actionBar } = buildPost({ withQuote: true, withPhotos: false });
    const api = getApi();
    const post = api.extractPost(article, "https://x.com/home")!;
    expect(post.url).toBe("https://x.com/carguy/status/1840000000000000001");
    expect(post.text).toBe("Golden hour on the 911 🔥\n35mm, f/2");
    expect(post.media).toEqual([]);
    expect(post.quotedPost).toEqual({
      url: "https://x.com/quoted/status/1799999999999999999",
      authorName: "Quoted Person",
      authorHandle: "quoted",
      text: "the original take",
    });
    expect(api.getActionBar(article)).toBe(actionBar);
  });

  test("falls back to the page url on a post page with no timestamp link", () => {
    const article = h(
      "article",
      { "data-testid": "tweet" },
      userName("Solo", "solo"),
      h("div", { "data-testid": "tweetText" }, "focal post"),
    );
    const post = getApi().extractPost(article, "https://x.com/solo/status/1840000000000000002")!;
    expect(post.url).toBe("https://x.com/solo/status/1840000000000000002");
    expect(post.text).toBe("focal post");
  });

  test("returns null when no permalink can be found", () => {
    const article = h("article", { "data-testid": "tweet" }, h("div", { "data-testid": "tweetText" }, "ad"));
    expect(getApi().extractPost(article, "https://x.com/home")).toBeNull();
  });
});
