(function registerXAdapter(globalScope) {
  "use strict";

  // X (x.com / twitter.com) posts. Unlike the image adapters, the unit here is
  // the POST: each `article[data-testid="tweet"]` gets a save button in its
  // action bar, and a save captures the post's text, author, permalink, time,
  // media and counts as bookmark metadata. The gallery stores the post as a
  // bookmark with a preview image (its first photo, or a crop of the post).

  const POST_SELECTOR = 'article[data-testid="tweet"]';
  const USER_NAME_SELECTOR = '[data-testid="User-Name"]';
  const TEXT_SELECTOR = '[data-testid="tweetText"]';
  const PHOTO_SELECTOR = '[data-testid="tweetPhoto"] img';
  const VIDEO_SELECTOR = '[data-testid="videoPlayer"] video, [data-testid="videoComponent"] video';
  const AVATAR_SELECTOR = '[data-testid="Tweet-User-Avatar"] img';
  const VERIFIED_SELECTOR = '[data-testid="icon-verified"]';
  const STATUS_PATH = /^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})(?:\/|$)/;
  const RESERVED_HANDLES = new Set(["i", "home", "explore", "search", "settings", "messages", "notifications"]);

  function isXPage(hostname) {
    const host = String(hostname || globalScope.location?.hostname || "")
      .toLowerCase()
      .replace(/^www\./, "");
    return (
      host === "x.com" ||
      host === "twitter.com" ||
      host === "mobile.x.com" ||
      host === "mobile.twitter.com"
    );
  }

  // "/handle/status/123/photo/1" or a full URL → { handle, statusId, url }.
  function parseStatusUrl(href, base) {
    if (!href) return null;
    let url;
    try {
      url = new URL(String(href), base || "https://x.com");
    } catch {
      return null;
    }
    const match = STATUS_PATH.exec(url.pathname);
    if (!match) return null;
    const [, handle, statusId] = match;
    if (RESERVED_HANDLES.has(handle.toLowerCase())) {
      return { handle: "", statusId, url: `https://x.com/i/web/status/${statusId}` };
    }
    return { handle, statusId, url: `https://x.com/${handle}/status/${statusId}` };
  }

  // "1.2K" → 1200, "3,456" → 3456, "2M" → 2000000.
  function parseCount(value) {
    const raw = String(value || "").trim().replace(/,/g, "");
    const match = /^(\d+(?:\.\d+)?)\s*([KkMmBb])?$/.exec(raw);
    if (!match) return undefined;
    const base = Number.parseFloat(match[1]);
    const unit = (match[2] || "").toUpperCase();
    const multiplier = unit === "K" ? 1e3 : unit === "M" ? 1e6 : unit === "B" ? 1e9 : 1;
    return Math.round(base * multiplier);
  }

  // The action bar's aria-label reads like
  // "12 replies, 34 reposts, 567 likes, 8 bookmarks, 12345 views".
  function parseMetricsLabel(label) {
    const metrics = {};
    const text = String(label || "").toLowerCase();
    const pattern = /([\d.,]+\s*[kmb]?)\s+(repl(?:y|ies)|reposts?|retweets?|likes?|bookmarks?|views?)/g;
    let match;
    while ((match = pattern.exec(text))) {
      const count = parseCount(match[1].replace(/\s+/g, ""));
      if (count === undefined) continue;
      const word = match[2];
      if (word.startsWith("repl")) metrics.replies = count;
      else if (word.startsWith("repost") || word.startsWith("retweet")) metrics.reposts = count;
      else if (word.startsWith("like")) metrics.likes = count;
      else if (word.startsWith("bookmark")) metrics.bookmarks = count;
      else if (word.startsWith("view")) metrics.views = count;
    }
    return Object.keys(metrics).length ? metrics : undefined;
  }

  // pbs.twimg.com media come as ?format=jpg&name=small. Ask for the original.
  function toOriginalMediaUrl(src) {
    try {
      const url = new URL(String(src));
      if (url.hostname !== "pbs.twimg.com" || !url.pathname.startsWith("/media/")) {
        return url.toString();
      }
      url.searchParams.set("name", "orig");
      return url.toString();
    } catch {
      return "";
    }
  }

  // Profile images: _normal (48px) → _400x400 for a usable avatar.
  function toLargeAvatarUrl(src) {
    const value = String(src || "");
    if (!/pbs\.twimg\.com\/profile_images\//.test(value)) return value;
    return value.replace(/_(normal|bigger|mini|200x200)(\.\w+)$/, "_400x400$2");
  }

  // Post text keeps emoji (rendered as <img alt="😀">) and line breaks.
  function readRichText(element) {
    if (!element) return "";
    let out = "";
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === 3) {
        out += node.nodeValue || "";
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = String(node.tagName || "").toUpperCase();
      if (tag === "IMG") {
        out += node.getAttribute?.("alt") || "";
        return;
      }
      if (tag === "BR") {
        out += "\n";
        return;
      }
      for (const child of node.childNodes || []) walk(child);
    };
    walk(element);
    return out.replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").trim();
  }

  function readHandleFromUserName(userNameEl) {
    if (!userNameEl) return "";
    for (const span of userNameEl.querySelectorAll("span")) {
      const text = String(span.textContent || "").trim();
      if (/^@[A-Za-z0-9_]{1,15}$/.test(text)) return text.slice(1);
    }
    for (const link of userNameEl.querySelectorAll("a[href]")) {
      const match = /^\/([A-Za-z0-9_]{1,15})$/.exec(link.getAttribute("href") || "");
      if (match && !RESERVED_HANDLES.has(match[1].toLowerCase())) return match[1];
    }
    return "";
  }

  function readDisplayName(userNameEl) {
    if (!userNameEl) return "";
    const firstLink = userNameEl.querySelector("a[href]");
    const text = readRichText(firstLink || userNameEl).split("\n")[0] || "";
    return text.replace(/@[A-Za-z0-9_]{1,15}.*$/, "").trim();
  }

  // The quoted post (if any) is the region holding the second User-Name block.
  function getQuotedRoot(article) {
    const names = article.querySelectorAll(USER_NAME_SELECTOR);
    if (names.length < 2) return null;
    return names[1].closest('div[role="link"]') || names[1].parentElement || null;
  }

  function outside(quotedRoot) {
    return (el) => !quotedRoot || !quotedRoot.contains(el);
  }

  function firstOutside(article, selector, quotedRoot) {
    return [...article.querySelectorAll(selector)].find(outside(quotedRoot)) || null;
  }

  function readPermalink(article, quotedRoot, locationHref) {
    for (const time of article.querySelectorAll("time")) {
      if (quotedRoot && quotedRoot.contains(time)) continue;
      const link = time.closest("a[href]");
      const parsed = parseStatusUrl(link?.getAttribute("href"), locationHref);
      if (parsed) return { ...parsed, time };
    }
    for (const link of article.querySelectorAll('a[href*="/status/"]')) {
      if (quotedRoot && quotedRoot.contains(link)) continue;
      const parsed = parseStatusUrl(link.getAttribute("href"), locationHref);
      if (parsed) return { ...parsed, time: null };
    }
    // The focal post on a /status/ page can render without a timestamp link.
    const fromLocation = parseStatusUrl(locationHref);
    return fromLocation ? { ...fromLocation, time: null } : null;
  }

  function readMedia(article, quotedRoot) {
    const media = [];
    const seen = new Set();
    const keep = outside(quotedRoot);
    for (const img of article.querySelectorAll(PHOTO_SELECTOR)) {
      if (!keep(img)) continue;
      const url = toOriginalMediaUrl(img.currentSrc || img.src || img.getAttribute("src"));
      if (!url || seen.has(url)) continue;
      seen.add(url);
      media.push({
        kind: "image",
        url,
        width: Number(img.naturalWidth) || undefined,
        height: Number(img.naturalHeight) || undefined,
        alt: String(img.getAttribute("alt") || "").trim() || undefined,
      });
    }
    for (const video of article.querySelectorAll(VIDEO_SELECTOR)) {
      if (!keep(video)) continue;
      const poster = String(video.getAttribute("poster") || "").trim();
      if (!/^https?:/i.test(poster) || seen.has(poster)) continue;
      seen.add(poster);
      const src = String(video.currentSrc || video.getAttribute("src") || "");
      media.push({
        kind: /tweet_video/i.test(src) || /tweet_video_thumb/i.test(poster) ? "gif" : "video",
        url: poster,
        width: Number(video.videoWidth) || undefined,
        height: Number(video.videoHeight) || undefined,
      });
    }
    return media;
  }

  function readQuotedPost(quotedRoot, locationHref) {
    if (!quotedRoot) return undefined;
    const userName = quotedRoot.querySelector(USER_NAME_SELECTOR);
    const textEl = quotedRoot.querySelector(TEXT_SELECTOR);
    let url;
    for (const link of quotedRoot.querySelectorAll('a[href*="/status/"]')) {
      const parsed = parseStatusUrl(link.getAttribute("href"), locationHref);
      if (parsed) {
        url = parsed.url;
        break;
      }
    }
    const quoted = {
      url,
      authorName: readDisplayName(userName) || undefined,
      authorHandle: readHandleFromUserName(userName) || undefined,
      text: readRichText(textEl) || undefined,
    };
    return quoted.url || quoted.text ? quoted : undefined;
  }

  function getActionBar(article) {
    const quotedRoot = getQuotedRoot(article);
    const groups = [...article.querySelectorAll('[role="group"]')].filter(outside(quotedRoot));
    return groups[groups.length - 1] || null;
  }

  // Everything the gallery stores about a post. Returns null when the post
  // has no resolvable permalink (ads, placeholders).
  function extractPost(article, locationHref) {
    if (!article) return null;
    const href = locationHref || globalScope.location?.href || "";
    const quotedRoot = getQuotedRoot(article);
    const permalink = readPermalink(article, quotedRoot, href);
    if (!permalink) return null;

    const userName = firstOutside(article, USER_NAME_SELECTOR, quotedRoot);
    const textEl = firstOutside(article, TEXT_SELECTOR, quotedRoot);
    const avatar = firstOutside(article, AVATAR_SELECTOR, quotedRoot);
    const actionBar = getActionBar(article);
    const datetime = permalink.time?.getAttribute("datetime");
    const postedAt = datetime ? Date.parse(datetime) : NaN;
    const handle = readHandleFromUserName(userName) || permalink.handle;
    const url = handle
      ? `https://x.com/${handle}/status/${permalink.statusId}`
      : permalink.url;

    return {
      url,
      externalId: permalink.statusId,
      authorName: readDisplayName(userName) || undefined,
      authorHandle: handle || undefined,
      authorAvatarUrl: avatar ? toLargeAvatarUrl(avatar.currentSrc || avatar.src) || undefined : undefined,
      authorVerified: userName ? Boolean(userName.querySelector(VERIFIED_SELECTOR)) : undefined,
      text: readRichText(textEl) || undefined,
      lang: textEl?.getAttribute("lang") || undefined,
      postedAt: Number.isFinite(postedAt) ? postedAt : undefined,
      media: readMedia(article, quotedRoot),
      quotedPost: readQuotedPost(quotedRoot, href),
      metrics: parseMetricsLabel(actionBar?.getAttribute("aria-label")),
    };
  }

  function getPostRoots(doc) {
    return [...(doc || globalScope.document).querySelectorAll(POST_SELECTOR)];
  }

  globalScope.SaveToGalleryX = {
    POST_SELECTOR,
    isXPage,
    parseStatusUrl,
    parseCount,
    parseMetricsLabel,
    toOriginalMediaUrl,
    toLargeAvatarUrl,
    readRichText,
    getActionBar,
    getPostRoots,
    extractPost,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
