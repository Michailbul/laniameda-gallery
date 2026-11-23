import { describe, expect, test } from "bun:test";
import {
  applyRecipe, buildChatMessages, cleanRecipe, parseChatAnswer, recipeLabel, runSettings, settingsLabel, threadOpening, withOpening,
} from "../lib/mj-thread";

const storybook = "Painted storybook animation frame. A cutaway view of a whole top-floor apartment. Warm morning light.";
const params = "--ar 16:9 --chaos 25 --stylize 300 --hd";

describe("thread recipes", () => {
  test("stylize, chaos, raw and hd change only their flags", () => {
    const out = applyRecipe({ prompt: storybook, profileCodes: ["e6pj8eo", "ejo6q4d"], params }, cleanRecipe({ stylize: 750, raw: true, hd: false, chaos: null }));
    expect(out.params).toBe("--ar 16:9 --stylize 750 --raw");
    expect(out.profileCodes).toEqual(["e6pj8eo", "ejo6q4d"]);
    expect(out.prompt).toBe(storybook);
  });

  test("profiles are replaced, added and removed", () => {
    const base = { prompt: storybook, profileCodes: ["e6pj8eo", "ejo6q4d"], params };
    expect(applyRecipe(base, { profileCodes: ["cas1main"] }).profileCodes).toEqual(["cas1main"]);
    expect(applyRecipe(base, { addProfileCodes: ["cas1main"], removeProfileCodes: ["ejo6q4d"] }).profileCodes).toEqual(["e6pj8eo", "cas1main"]);
  });

  test("the keyword opening is swapped, added or removed", () => {
    const opening = threadOpening([storybook, "Painted storybook animation frame. A kitchen.", "A roof."]);
    expect(opening).toBe("Painted storybook animation frame.");
    expect(withOpening(storybook, opening, "Cinematic 3D animation still")).toBe("Cinematic 3D animation still. A cutaway view of a whole top-floor apartment. Warm morning light.");
    expect(withOpening(storybook, opening, "")).toBe("A cutaway view of a whole top-floor apartment. Warm morning light.");
    expect(withOpening("A roof.", opening, "Cinematic 3D animation still.")).toBe("Cinematic 3D animation still. A roof.");
  });

  test("bad values are refused in plain words", () => {
    expect(() => cleanRecipe({ stylize: 5000 })).toThrow("stylize is 0 to 1000");
    expect(() => cleanRecipe({ ar: "wide" })).toThrow("Aspect");
    expect(() => cleanRecipe({ profileCodes: ["--bad code"] })).toThrow("not a Midjourney");
  });

  test("a recipe reads in a few words", () => {
    expect(recipeLabel(cleanRecipe({ stylize: 750, profileCodes: ["cas1main"] }))).toBe("profiles cas1main · stylize 750");
  });

  test("a run's settings: what most prompts carry", () => {
    const settings = runSettings([
      { prompt: storybook, profileCodes: ["e6pj8eo", "ejo6q4d"], params },
      { prompt: "Painted storybook animation frame. A kitchen.", profileCodes: ["e6pj8eo", "ejo6q4d"], params },
    ]);
    expect(settingsLabel(settings)).toBe("e6pj8eo ejo6q4d · stylize 300 · chaos 25 · 16:9 · hd");
    expect(settings.opening).toBe("Painted storybook animation frame.");
    expect(settings.mixed).toEqual([]);
  });
});

describe("chat answers", () => {
  test("a JSON answer becomes a reply and checked operations", () => {
    const answer = parseChatAnswer('```json\n{"reply":"Run 2 queued at stylize 750.","ops":[{"op":"rerun","recipe":{"stylize":750}},{"op":"skip","items":[4,"5"]},{"op":"fly"}]}\n```');
    expect(answer.reply).toBe("Run 2 queued at stylize 750.");
    expect(answer.ops).toEqual([
      { op: "rerun", items: undefined, fromRun: undefined, recipe: { stylize: 750 }, prompts: undefined, note: undefined },
      { op: "skip", items: [4, 5] },
    ]);
    expect(answer.dropped).toEqual(["unknown operation fly"]);
  });

  test("a bad recipe is dropped, not applied", () => {
    const answer = parseChatAnswer('{"reply":"ok","ops":[{"op":"recipe","recipe":{"stylize":9000}}]}');
    expect(answer.ops).toEqual([]);
    expect(answer.dropped[0]).toContain("stylize");
  });

  test("plain text is a reply with no changes", () => {
    expect(parseChatAnswer("Which profile do you mean?")).toEqual({ reply: "Which profile do you mean?", ops: [], dropped: [] });
  });

  test("the writer sees numbered prompts, runs, codes and the chat", () => {
    const [system, user] = buildChatMessages({
      batch: "CASSANDRA · Storybook v2", worldName: "CASSANDRA",
      items: [{ n: 1, status: "sent", run: 1, title: "apartment", prompt: storybook, profileCodes: ["e6pj8eo"], params, srefs: [] }],
      runs: [{ run: 1, label: "e6pj8eo · stylize 300", count: 1 }],
      history: [{ role: "michael", text: "make it darker" }, { role: "agent", text: "Done.", changes: ["Edited #1"] }],
      message: "swap the profile to CAS Main 1",
      profiles: [{ name: "CAS Main 1", code: "cas1main", kind: "profile" }],
    });
    expect(system!.content).toContain("ONE JSON object");
    expect(user!.content).toContain("#1 · run 1 · sent · apartment");
    expect(user!.content).toContain("CAS Main 1 (profile): cas1main");
    expect(user!.content).toContain("MICHAEL NOW: swap the profile to CAS Main 1");
    expect(user!.content).toContain("(changed: Edited #1)");
  });
});
