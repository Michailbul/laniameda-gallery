import { beforeAll, describe, expect, test } from "bun:test";

type MidjourneyAdapterApi = {
  extractUrlsFromCssImage: (value: string) => string[];
  findJobObject: (el: unknown) => unknown;
  getBestSrcFromSrcset: (srcset: string) => string;
  getJobPageSelection: (pageUrl: string) => { jobId: string; index: number } | null;
  getMediaUrl: (el: unknown) => string;
  getOriginalImageUrl: (mediaUrl: string, pageUrl: string) => string;
  isQualifiedMediaElement: (
    el: unknown,
    options?: { badgeAttr?: string },
  ) => boolean;
  isLikedGenerationElement: (el: unknown) => boolean;
  reconstructPrompt: (job: unknown) => string | null;
  getSaveSelection: (mediaUrl: string, pageUrl: string) => { jobId: string; index: number } | null;
  parseCommand: (command: string) => Record<string, unknown> & { codes: string[]; otherFlags: string[] };
  readLightboxContext: (root: unknown) => {
    command: string;
    personalization: Array<{ code: string; type?: string; name?: string }>;
  } | null;
  collectSaveMetadata: (input: {
    imageUrl: string;
    pageUrl: string;
    lightboxRoot?: unknown;
    readPageJob?: (jobId: string) => Promise<unknown>;
    fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  }) => Promise<{ promptText: string; metadata: Record<string, unknown> } | null>;
};

const getApi = () =>
  (globalThis as typeof globalThis & {
    SaveToGalleryMidjourney: MidjourneyAdapterApi;
  }).SaveToGalleryMidjourney;

beforeAll(async () => {
  await import("../extension/midjourney-adapter.js");
});

const createImage = ({
  src = "https://cdn.midjourney.com/job/0_1_384_N.webp",
  srcset = "https://cdn.midjourney.com/job/0_1_384_N.webp 384w, https://cdn.midjourney.com/job/0_1_640_N.webp 640w",
  width = 320,
  height = 320,
  hasBadge = false,
} = {}) => ({
  tagName: "IMG",
  src,
  currentSrc: src,
  srcset,
  naturalWidth: 640,
  naturalHeight: 640,
  width,
  height,
  clientWidth: width,
  clientHeight: height,
  offsetWidth: width,
  offsetHeight: height,
  hasAttribute: (name: string) => hasBadge && name === "data-stg-mj-media-badge",
  getBoundingClientRect: () => ({ width, height }),
});

describe("Midjourney extension adapter", () => {
  test("selects the largest srcset candidate", () => {
    const api = getApi();

    expect(
      api.getBestSrcFromSrcset(
        "https://cdn.midjourney.com/job/0_1_384_N.webp 384w, https://cdn.midjourney.com/job/0_1_640_N.webp 640w",
      ),
    ).toBe("https://cdn.midjourney.com/job/0_1_640_N.webp");
  });

  test("resolves a job page selection to the canonical original PNG", () => {
    const api = getApi();
    const jobId = "5d5b10a7-653a-4214-90ce-fb299c22a8d0";
    const pageUrl = `https://www.midjourney.com/jobs/${jobId}?index=2`;

    expect(api.getJobPageSelection(pageUrl)).toEqual({ jobId, index: 2 });
    expect(
      api.getOriginalImageUrl(
        `https://cdn.midjourney.com/${jobId}/0_2_1024_N.webp?method=shortest`,
        pageUrl,
      ),
    ).toBe(`https://cdn.midjourney.com/${jobId}/0_2.png`);
  });

  test("derives the original PNG from a Midjourney derivative without a job page", () => {
    const api = getApi();
    const jobId = "5d5b10a7-653a-4214-90ce-fb299c22a8d0";

    expect(
      api.getOriginalImageUrl(
        `https://cdn.midjourney.com/${jobId}/0_3_640_N.webp`,
        "https://www.midjourney.com/imagine",
      ),
    ).toBe(`https://cdn.midjourney.com/${jobId}/0_3.png`);
  });

  test("extracts css image urls and prefers the final image-set candidate", () => {
    const api = getApi();
    const css =
      'image-set(url("https://cdn.midjourney.com/job/0_1_384_N.webp") 1x, url("https://cdn.midjourney.com/job/0_1_1024_N.webp") 2x)';

    expect(api.extractUrlsFromCssImage(css)).toEqual([
      "https://cdn.midjourney.com/job/0_1_384_N.webp",
      "https://cdn.midjourney.com/job/0_1_1024_N.webp",
    ]);
  });

  test("qualifies visible Midjourney img elements", () => {
    const api = getApi();
    const img = createImage();

    expect(
      api.isQualifiedMediaElement(img, {
        badgeAttr: "data-stg-mj-media-badge",
      }),
    ).toBe(true);
    expect(api.getMediaUrl(img)).toBe(
      "https://cdn.midjourney.com/job/0_1_640_N.webp",
    );
  });

  test("rejects already-badged or tiny Midjourney images", () => {
    const api = getApi();

    expect(
      api.isQualifiedMediaElement(createImage({ hasBadge: true }), {
        badgeAttr: "data-stg-mj-media-badge",
      }),
    ).toBe(false);
    expect(api.isQualifiedMediaElement(createImage({ width: 48, height: 48 }))).toBe(false);
  });

  test("finds a React job object and reconstructs prompt flags", () => {
    const api = getApi();
    const el = {
      parentElement: null,
      "__reactFiber$test": {
        memoizedProps: {
          job: {
            prompt: {
              decodedPrompt: [
                { content: "cinematic portrait", weight: 1 },
                { content: "peach studio light", weight: 1.25 },
              ],
              ar: { w: 2, h: 3 },
              stylize: 150,
              version: "6.1",
            },
          },
        },
      },
    };

    const job = api.findJobObject(el);
    expect(api.reconstructPrompt(job)).toBe(
      "cinematic portrait peach studio light::1.25 --ar 2:3 --stylize 150 --v 6.1",
    );
  });

  test("detects liked generations from Midjourney like controls", () => {
    const api = getApi();
    const likedCard = {
      querySelectorAll: () => [
        {
          textContent: "",
          getAttribute: (name: string) => name === "title" ? "Unlike Image (L)" : "",
        },
      ],
    };
    const unlikedCard = {
      querySelectorAll: () => [
        {
          textContent: "",
          getAttribute: (name: string) => name === "title" ? "Like Image (L)" : "",
        },
      ],
    };

    expect(api.isLikedGenerationElement(likedCard)).toBe(true);
    expect(api.isLikedGenerationElement(unlikedCard)).toBe(false);
  });

  test("falls back to React job liked state", () => {
    const api = getApi();
    const el = {
      parentElement: null,
      querySelectorAll: () => [],
      "__reactFiber$test": {
        memoizedProps: {
          job: {
            prompt: { decodedPrompt: "portrait" },
            isLiked: true,
          },
        },
      },
    };

    expect(api.isLikedGenerationElement(el)).toBe(true);
  });

  describe("save metadata", () => {
    const jobId = "edbfc881-5abb-4d36-8553-27fd4d84bbb3";
    const fullCommand =
      "A high bedroom, night. --chaos 20 --ar 4:3 --profile w5eljw4 8fpptvh --stylize 650 --hd --v 8.2";
    const pageJob = {
      id: jobId,
      prompt: { seed: "5106", speed: "relax", decodedPrompt: [{ content: "A high bedroom, night.", weight: 1 }] },
      personalization_codes: [
        { code: "w5eljw4", type: "moodboard", id: "7510649976797390241" },
        { code: "8fpptvh", type: "profile", id: "7510052809210155454" },
      ],
    };
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status });
    const midjourneyFetch = (overrides: { jobStatus?: () => Response } = {}) =>
      async (url: string) => {
        if (url.endsWith("/api/job-status")) {
          return overrides.jobStatus?.() ?? json([{ id: jobId, full_command: fullCommand }]);
        }
        if (url.endsWith("/api/moodboards")) {
          return json([{ moodboard_id: "7510649976797390241", title: "DA DECO · World" }]);
        }
        if (url.endsWith("/api/personalized-profiles")) {
          return json({ profiles: [{ id: "7510052809210155454", title: "ART DECO 1" }] });
        }
        return json({ error: "Invalid request" }, 400);
      };

    // A prompt panel as Midjourney renders it: one button per flag.
    const flagButton = (flag: string, label: string) => ({
      querySelector: (selector: string) =>
        selector === "span.text-transparent"
          ? { textContent: flag }
          : selector === "span.select-none"
            ? { textContent: label }
            : null,
    });
    const lightbox = {
      querySelector: () => ({ textContent: " A high bedroom, night. " }),
      querySelectorAll: () => [
        flagButton("--chaos 20", "chaos 20"),
        flagButton("--hd ", "hd"),
        flagButton("--profile w5eljw4", "moodboard DA DECO · World"),
        flagButton("--profile 8fpptvh", "profile ART DECO 1"),
      ],
    };

    test("the media URL picks the tile, the page URL only stands in for it", () => {
      const api = getApi();
      const page = `https://www.midjourney.com/jobs/${jobId}?index=1`;
      const other = "5d5b10a7-653a-4214-90ce-fb299c22a8d0";

      expect(api.getSaveSelection(`https://cdn.midjourney.com/${other}/0_3_640_N.webp`, page))
        .toEqual({ jobId: other, index: 3 });
      expect(api.getSaveSelection("data:image/webp;base64,AAAA", page))
        .toEqual({ jobId, index: 1 });
      expect(api.getSaveSelection("https://cdn.midjourney.com/u/a/b.webp", "https://www.midjourney.com/imagine"))
        .toBeNull();
    });

    test("parses every setting out of a full command", () => {
      const parsed = getApi().parseCommand(
        "https://s.mj.run/abc a knight --chaos 65 --ar 2:1 --raw --profile nhwnqau m123 --stylize 600 --v 8.2 --hd --seed 42 --relax --no text, red hats --sref 777 --weird 20",
      );

      expect(parsed).toMatchObject({
        chaos: 65,
        aspectRatio: "2:1",
        raw: true,
        codes: ["nhwnqau", "m123"],
        stylize: 600,
        version: "8.2",
        hd: true,
        seed: "42",
        speed: "relax",
        no: ["text", "red hats"],
        otherFlags: ["--sref 777", "--weird 20"],
      });
    });

    test("reads short aliases and a bare --p", () => {
      expect(getApi().parseCommand("x --s 100 --c 5 --style raw --p abc --q 2")).toMatchObject({
        stylize: 100, chaos: 5, raw: true, codes: ["abc"], otherFlags: ["--q 2"],
      });
      expect(getApi().parseCommand("x --p").otherFlags).toEqual(["--p"]);
    });

    test("does not take a double dash inside a word for a flag", () => {
      expect(getApi().parseCommand("a well--made coat --ar 1:1")).toMatchObject({
        aspectRatio: "1:1", otherFlags: [],
      });
    });

    test("reads moodboard and profile names off the job page panel", () => {
      expect(getApi().readLightboxContext(lightbox)).toEqual({
        command: "A high bedroom, night. --chaos 20 --hd --profile w5eljw4 --profile 8fpptvh",
        personalization: [
          { code: "w5eljw4", type: "moodboard", name: "DA DECO · World" },
          { code: "8fpptvh", type: "profile", name: "ART DECO 1" },
        ],
      });
    });

    test("a grid tile gets the command, names, seed and speed with no job page open", async () => {
      const collected = await getApi().collectSaveMetadata({
        imageUrl: `https://cdn.midjourney.com/${jobId}/0_2_640_N.webp?method=shortest`,
        pageUrl: "https://www.midjourney.com/imagine",
        readPageJob: async () => pageJob,
        fetchImpl: midjourneyFetch(),
      });

      expect(collected?.promptText).toBe(fullCommand);
      expect(collected?.metadata).toMatchObject({
        jobId,
        tileIndex: 2,
        aspectRatio: "4:3",
        stylize: 650,
        chaos: 20,
        version: "8.2",
        hd: true,
        seed: "5106",
        speed: "relax",
        personalization: [
          { code: "w5eljw4", type: "moodboard", name: "DA DECO · World", id: "7510649976797390241" },
          { code: "8fpptvh", type: "profile", name: "ART DECO 1", id: "7510052809210155454" },
        ],
      });
    });

    test("a job page keeps its names when only the panel can be read", async () => {
      const collected = await getApi().collectSaveMetadata({
        imageUrl: `https://cdn.midjourney.com/${jobId}/0_1.png`,
        pageUrl: `https://www.midjourney.com/jobs/${jobId}?index=1`,
        lightboxRoot: lightbox,
        readPageJob: async () => { throw new Error("no page world"); },
        fetchImpl: midjourneyFetch({ jobStatus: () => json({ error: "Invalid request" }, 400) }),
      });

      expect(collected?.promptText).toContain("A high bedroom, night.");
      expect(collected?.metadata).toMatchObject({
        tileIndex: 1,
        chaos: 20,
        hd: true,
        personalization: [
          { code: "w5eljw4", type: "moodboard", name: "DA DECO · World" },
          { code: "8fpptvh", type: "profile", name: "ART DECO 1" },
        ],
      });
    });

    test("the panel of another job never labels the saved tile", async () => {
      const other = "5d5b10a7-653a-4214-90ce-fb299c22a8d0";
      const collected = await getApi().collectSaveMetadata({
        imageUrl: `https://cdn.midjourney.com/${other}/0_0_640_N.webp`,
        pageUrl: `https://www.midjourney.com/jobs/${jobId}?index=1`,
        lightboxRoot: lightbox,
        readPageJob: async () => null,
        fetchImpl: async () => json({ error: "Invalid request" }, 400),
      });

      expect(collected?.promptText).toBe("");
      expect(collected?.metadata).toMatchObject({ jobId: other, tileIndex: 0, personalization: [] });
    });

    test("job-status for a different job is ignored", async () => {
      const collected = await getApi().collectSaveMetadata({
        imageUrl: `https://cdn.midjourney.com/${jobId}/0_0_640_N.webp`,
        pageUrl: "https://www.midjourney.com/imagine",
        readPageJob: async () => null,
        fetchImpl: async () => json([{ id: "someone-else", full_command: "wrong --ar 9:9" }]),
      });

      expect(collected?.promptText).toBe("");
      expect(collected?.metadata.aspectRatio).toBeUndefined();
    });

    test("falls back to the page job when job-status is rejected", async () => {
      const collected = await getApi().collectSaveMetadata({
        imageUrl: `https://cdn.midjourney.com/${jobId}/0_0_640_N.webp`,
        pageUrl: "https://www.midjourney.com/imagine",
        readPageJob: async () => pageJob,
        fetchImpl: midjourneyFetch({ jobStatus: () => json({ error: "Invalid request" }, 400) }),
      });

      expect(collected?.promptText).toContain("A high bedroom, night.");
      expect(collected?.metadata.personalization).toHaveLength(2);
    });

    test("media with no job id yields nothing, so the save goes on as it was", async () => {
      expect(
        await getApi().collectSaveMetadata({
          imageUrl: "https://cdn.midjourney.com/u/avatar.webp",
          pageUrl: "https://www.midjourney.com/imagine",
          fetchImpl: midjourneyFetch(),
        }),
      ).toBeNull();
    });
  });
});
