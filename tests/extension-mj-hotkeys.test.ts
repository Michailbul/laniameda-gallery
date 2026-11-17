import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type Hotkeys = {
  ACTIONS: { id: string; group: string; label: string }[];
  DEFAULTS: Record<string, string>;
  RESERVED: Record<string, string>;
  resolve: (stored: unknown) => { enabled: boolean; bindings: Record<string, string> };
  comboMap: (resolved: unknown) => Map<string, string>;
  formatCombo: (combo: string, mac?: boolean) => string;
};

const api = () => (globalThis as unknown as { SaveToGalleryHotkeys: Hotkeys }).SaveToGalleryHotkeys;

beforeAll(async () => {
  await import("../extension/mj-hotkeys.js");
});

describe("dock keys: Randomize (17 Nov 2026)", () => {
  test("⌥R and ⌥⇧R reroll, in their own group so the settings tab can rebind them", () => {
    const mix = api().ACTIONS.filter((action) => action.group === "Randomize").map((action) => action.id);
    expect(mix).toEqual(["mix:random", "mix:extreme"]);
    expect(api().DEFAULTS["mix:random"]).toBe("Alt+KeyR");
    expect(api().DEFAULTS["mix:extreme"]).toBe("Alt+Shift+KeyR");
    const map = api().comboMap(api().resolve(null));
    expect(map.get("Alt+KeyR")).toBe("mix:random");
    expect(map.get("Alt+Shift+KeyR")).toBe("mix:extreme");
    expect(api().formatCombo("Alt+Shift+KeyR", true)).toBe("⌥⇧R");
  });

  test("the keys other parts of the extension use are reserved, and no default takes one", () => {
    for (const combo of ["Alt+KeyE", "Alt+KeyX", "Alt+KeyF", "Alt+Shift+KeyN", "Alt+Shift+KeyS", "Alt+Shift+KeyT"]) {
      expect(api().RESERVED[combo]).toBeTruthy();
    }
    for (const combo of Object.values(api().DEFAULTS)) expect(api().RESERVED[combo]).toBeUndefined();
  });

  test("a key saved before it was reserved goes back to the default", () => {
    const resolved = api().resolve({ bindings: { "preset:save": "Alt+KeyF", "world:pick": "Alt+Shift+KeyT", "mix:random": "" } });
    expect(resolved.bindings["preset:save"]).toBe("Alt+KeyS");
    expect(resolved.bindings["world:pick"]).toBe("Alt+KeyW");
    // Switched off by hand stays off.
    expect(resolved.bindings["mix:random"]).toBe("");
  });

  test("the settings tab lists every group of ACTIONS, so Randomize shows", () => {
    const settings = readFileSync(new URL("../extension/mj-hotkeys-settings.js", import.meta.url), "utf8");
    expect(settings).toContain("for (const action of api.ACTIONS)");
    expect(settings).toContain("action.group");
    expect(settings).toContain("Randomize");
  });
});
