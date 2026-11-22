import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The dock as it runs on midjourney.com, on a small fake page. Each test
// reproduces one of Michael's reports of 17 Nov 2026:
//  (a) "hotkey automatically applying some presets even though I did not want it"
//  (b) "sometimes UI bugs and not disappearing"
// plus the ⌥R reroll.

const read = (name: string) => readFileSync(join(import.meta.dir, "..", "extension", name), "utf8");
const SCRIPTS = ["mj-hotkeys.js", "mj-randomize.js", "moodboard-dock.js", "prompt-packs-data.js", "prompt-packs.js"].map(read);
const DOCK_SCRIPT = SCRIPTS[2]!;

/* ── a DOM just big enough for the dock ── */

type Fn = (event: FakeEvent) => void;
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

class FakeEvent {
  type: string;
  bubbles = false;
  isTrusted = false;
  defaultPrevented = false;
  stopped = false;
  stoppedNow = false;
  target: Any = null;
  currentTarget: Any = null;
  path: Any[] = [];
  key = "";
  code = "";
  altKey = false;
  ctrlKey = false;
  shiftKey = false;
  metaKey = false;
  repeat = false;
  isComposing = false;
  keyCode = 0;
  inputType = "";
  relatedTarget: Any = null;
  constructor(type: string, init: Record<string, unknown> = {}) {
    this.type = type;
    Object.assign(this, init);
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {
    this.stopped = true;
  }
  stopImmediatePropagation() {
    this.stopped = true;
    this.stoppedNow = true;
  }
  composedPath() {
    return this.path.slice();
  }
  getModifierState() {
    return false;
  }
}

class FakeTarget {
  listeners = new Map<string, { fn: Fn; capture: boolean }[]>();
  addEventListener(type: string, fn: Fn, options?: unknown) {
    const capture = options === true || Boolean(options && (options as { capture?: boolean }).capture);
    const list = this.listeners.get(type) || [];
    if (!list.some((entry) => entry.fn === fn && entry.capture === capture)) list.push({ fn, capture });
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: Fn, options?: unknown) {
    const capture = options === true || Boolean(options && (options as { capture?: boolean }).capture);
    this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => !(entry.fn === fn && entry.capture === capture)));
  }
  fire(event: FakeEvent, phase: "capture" | "target" | "bubble") {
    for (const entry of [...(this.listeners.get(event.type) || [])]) {
      if (phase === "capture" && !entry.capture) continue;
      if (phase === "bubble" && entry.capture) continue;
      event.currentTarget = this;
      entry.fn.call(this, event);
      if (event.stoppedNow) return;
    }
  }
  dispatchEvent(event: FakeEvent) {
    return dispatch(this, event);
  }
}

let env: Env;

function eventPath(target: Any): Any[] {
  const path = [target];
  let node = target;
  while (node) {
    if (node === env.window) break;
    node = node === env.doc ? env.window : node.parentElement || (node === env.doc.documentElement ? env.doc : null);
    if (node) path.push(node);
  }
  return path;
}

function dispatch(target: Any, event: FakeEvent) {
  event.target = target;
  event.path = eventPath(target);
  for (let index = event.path.length - 1; index > 0; index -= 1) {
    event.path[index].fire(event, "capture");
    if (event.stopped) return !event.defaultPrevented;
  }
  target.fire(event, "target");
  if (event.bubbles) {
    for (let index = 1; index < event.path.length && !event.stopped; index += 1) event.path[index].fire(event, "bubble");
  }
  return !event.defaultPrevented;
}

const dataAttr = (key: string) => `data-${String(key).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

function matchCompound(el: FakeElement, selector: string): boolean {
  const match = /^([a-z0-9]+)?((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)(:hover)?$/i.exec(selector);
  if (!match) throw new Error(`fake DOM cannot match ${selector}`);
  if (match[1] && el.tagName.toLowerCase() !== match[1].toLowerCase()) return false;
  for (const name of match[2]!.split(".").filter(Boolean)) if (!el.classList.contains(name)) return false;
  for (const attr of match[3]!.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    const value = el.getAttribute(attr[1]!);
    if (value == null || (attr[2] !== undefined && value !== attr[2])) return false;
  }
  if (match[4] && !el.isHovered()) return false;
  return true;
}

function matches(el: FakeElement, selector: string): boolean {
  if (selector === "*") return true;
  return selector.split(",").some((part) => {
    const [parent, child] = part.trim().split(/\s*>\s*/);
    if (child) return matchCompound(el, child) && Boolean(el.parentElement) && matchCompound(el.parentElement!, parent!);
    return matchCompound(el, parent!);
  });
}

class FakeElement extends FakeTarget {
  nodeType = 1;
  tagName: string;
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  attrs = new Map<string, string>();
  style: Record<string, string> = {};
  hidden = false;
  hover = false;
  text = "";
  value = "";
  type = "";
  src = "";
  alt = "";
  title = "";
  placeholder = "";
  maxLength = 0;
  spellcheck = true;
  loading = "";
  decoding = "";
  referrerPolicy = "";
  selectionStart = 0;
  selectionEnd = 0;
  offsetWidth = 200;
  scrollWidth = 0;
  clientWidth = 0;
  isContentEditable = false;
  dataset: Record<string, string | undefined>;
  constructor(tag: string) {
    super();
    this.tagName = tag.toUpperCase();
    this.dataset = new Proxy({} as Record<string, string | undefined>, {
      get: (_, key) => this.attrs.get(dataAttr(String(key))),
      set: (_, key, value) => {
        this.attrs.set(dataAttr(String(key)), String(value));
        return true;
      },
      deleteProperty: (_, key) => {
        this.attrs.delete(dataAttr(String(key)));
        return true;
      },
    });
  }
  get className() {
    return this.attrs.get("class") || "";
  }
  set className(value: string) {
    this.attrs.set("class", value);
  }
  get id() {
    return this.attrs.get("id") || "";
  }
  set id(value: string) {
    this.attrs.set("id", value);
  }
  get classList() {
    const names = () => this.className.split(/\s+/).filter(Boolean);
    const write = (list: string[]) => (this.className = list.join(" "));
    return {
      contains: (name: string) => names().includes(name),
      add: (name: string) => !names().includes(name) && write([...names(), name]),
      remove: (name: string) => write(names().filter((entry) => entry !== name)),
      toggle: (name: string, force?: boolean) => {
        const on = force === undefined ? !names().includes(name) : force;
        write(on ? [...new Set([...names(), name])] : names().filter((entry) => entry !== name));
        return on;
      },
    };
  }
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
  set textContent(value: string) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.text = String(value ?? "");
  }
  get isConnected(): boolean {
    return this.root() === env.doc.documentElement;
  }
  // This element and its ancestors, nearest first.
  chain(): FakeElement[] {
    const out: FakeElement[] = [this];
    while (out[out.length - 1]!.parentElement) out.push(out[out.length - 1]!.parentElement!);
    return out;
  }
  root() {
    const list = this.chain();
    return list[list.length - 1];
  }
  get lastElementChild() {
    return this.children[this.children.length - 1] || null;
  }
  get nextElementSibling() {
    const list = this.parentElement?.children || [];
    return list[list.indexOf(this) + 1] || null;
  }
  isHovered(): boolean {
    return this.hover || this.children.some((child) => child.isHovered());
  }
  append(...items: (FakeElement | string)[]) {
    for (const item of items) {
      if (typeof item === "string") {
        const text = new FakeElement("#text");
        text.nodeType = 3;
        text.text = item;
        this.appendChild(text);
      } else this.appendChild(item);
    }
  }
  appendChild(node: FakeElement) {
    node.remove();
    this.children.push(node);
    node.parentElement = this;
    return node;
  }
  insertBefore(node: FakeElement, ref: FakeElement | null | undefined) {
    if (!ref) return this.appendChild(node);
    node.remove();
    this.children.splice(this.children.indexOf(ref), 0, node);
    node.parentElement = this;
    return node;
  }
  remove() {
    if (!this.parentElement) return;
    const list = this.parentElement.children;
    list.splice(list.indexOf(this), 1);
    this.parentElement = null;
  }
  contains(node: FakeElement | null): boolean {
    for (let current = node; current; current = current.parentElement) if (current === this) return true;
    return false;
  }
  matches(selector: string) {
    return this.nodeType === 1 && matches(this, selector);
  }
  closest(selector: string) {
    return this.chain().find((node) => node.matches(selector)) || null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (node: FakeElement) => {
      for (const child of node.children) {
        if (child.nodeType === 1 && child.matches(selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] || null;
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, String(value));
  }
  getAttribute(name: string) {
    return this.attrs.has(name) ? this.attrs.get(name)! : null;
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  visible(): boolean {
    return !this.chain().some((node) => node.hidden) && this.isConnected;
  }
  getBoundingClientRect() {
    return { top: 600, bottom: 640, left: 10, right: 810, width: 800, height: 40 };
  }
  getClientRects() {
    return this.visible() ? [this.getBoundingClientRect()] : [];
  }
  focus() {
    const previous = env.doc.activeElement;
    if (previous === this) return;
    env.doc.activeElement = this;
    if (previous && previous !== env.doc.body) {
      previous.dispatchEvent(new FakeEvent("blur", { relatedTarget: this }));
      previous.dispatchEvent(new FakeEvent("focusout", { bubbles: true, relatedTarget: this }));
    }
    this.dispatchEvent(new FakeEvent("focusin", { bubbles: true, relatedTarget: previous }));
  }
  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
  select() {}
  scrollIntoView() {}
}

class FakeDocument extends FakeTarget {
  nodeType = 9;
  documentElement = new FakeElement("html");
  head = new FakeElement("head");
  body = new FakeElement("body");
  activeElement: FakeElement;
  visibilityState = "visible";
  constructor() {
    super();
    this.documentElement.append(this.head, this.body);
    this.activeElement = this.body;
  }
  createElement(tag: string) {
    return new FakeElement(tag);
  }
  querySelectorAll(selector: string) {
    return this.documentElement.querySelectorAll(selector);
  }
  querySelector(selector: string) {
    return this.documentElement.querySelector(selector);
  }
  getElementById(id: string) {
    return this.documentElement.querySelectorAll("*").find((node) => node.id === id) || null;
  }
}

/* ── the extension around it ── */

const WORLD = {
  ok: true,
  world: { key: "dear-annete", name: "DEAR ANNETE" },
  worlds: [
    { key: "dear-annete", name: "DEAR ANNETE" },
    { key: "andromeda-anya", name: "ANDROMEDA — ANYA" },
  ],
  moodboards: [
    { name: "DA FILM · Night", shortName: "Night", mjCode: "m1", previews: [{ url: "https://cdn.example/1.png" }] },
    { name: "DA FILM · Gold", shortName: "Gold", mjCode: "m2" },
  ],
  // DA4, DA5, CINEMATIC are the pinned main profiles, in that order.
  profiles: [
    { name: "CINEMATIC", code: "p1" },
    { name: "DA4", code: "p2" },
    { name: "DA5", code: "p3" },
  ],
  otherProfiles: [{ name: "ANYA", code: "o1", worlds: ["andromeda-anya"] }],
  galleryPresets: [],
};
const PRESET = { id: "psA", name: "Night wide", codes: ["m1", "p1"], params: "--ar 16:9 --s 750", packs: ["film"] };

type Env = ReturnType<typeof makeEnv>;

function makeEnv(options: { sticky?: unknown; presets?: unknown[] } = {}) {
  const doc = new FakeDocument();
  const win = Object.assign(new FakeTarget(), { innerWidth: 1200, innerHeight: 800 });
  const local: Record<string, unknown> = { stgMoodboardSticky: options.sticky ?? {} };
  const sync: Record<string, unknown> = { "stgMjPresets:dear-annete": options.presets ?? [PRESET] };
  const storageListeners: ((changes: unknown, area: string) => void)[] = [];
  const frames: (() => void)[] = [];
  const observers: ((records: unknown[]) => void)[] = [];
  const pick = (store: Record<string, unknown>, keys: unknown) => {
    const list = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(list.filter((key) => key in store).map((key) => [key, store[key as string]]));
  };
  const chrome = {
    runtime: {
      id: "ext",
      lastError: undefined,
      sendMessage(message: { action: string }, callback?: (res: unknown) => void) {
        callback?.(message.action === "listMoodboards" ? structuredClone(WORLD) : { ok: true });
      },
    },
    storage: {
      local: {
        get: (keys: unknown, callback: (stored: unknown) => void) => callback(pick(local, keys)),
        set: (values: Record<string, unknown>) => Object.assign(local, structuredClone(values)),
      },
      sync: {
        get: (keys: unknown, callback: (stored: unknown) => void) => callback(pick(sync, keys)),
        set: (values: Record<string, unknown>) => Object.assign(sync, structuredClone(values)),
      },
      onChanged: {
        addListener: (fn: (changes: unknown, area: string) => void) => storageListeners.push(fn),
        removeListener: (fn: (changes: unknown, area: string) => void) => storageListeners.splice(storageListeners.indexOf(fn), 1),
      },
    },
  };
  // The page: the Imagine bar in Midjourney's fixed bottom bar.
  const bar = doc.createElement("div");
  bar.className = "fixed";
  const box = doc.createElement("div");
  const area = doc.createElement("textarea");
  area.setAttribute("placeholder", "What will you imagine?");
  box.appendChild(area);
  bar.appendChild(box);
  doc.body.appendChild(bar);
  const search = doc.createElement("input");
  search.type = "text";
  doc.body.appendChild(search);
  const page = doc.createElement("div");
  doc.body.appendChild(page);
  return { doc, window: win, chrome, local, sync, storageListeners, frames, observers, area, search, page };
}

const GLOBALS = ["document", "window", "location", "chrome", "requestAnimationFrame", "getComputedStyle", "CSS", "Image", "Event", "HTMLTextAreaElement", "MutationObserver"];
const saved = new Map(GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
afterAll(() => {
  retireAll();
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Any)[name];
  }
});

function install(next: Env) {
  env = next;
  const values: Record<string, unknown> = {
    document: next.doc,
    window: next.window,
    location: { hostname: "www.midjourney.com", href: "https://www.midjourney.com/imagine" },
    chrome: next.chrome,
    requestAnimationFrame: (fn: () => void) => next.frames.push(fn),
    getComputedStyle: () => ({ overflowY: "visible" }),
    CSS: { escape: (value: string) => value },
    Image: class {
      decoding = "";
      src = "";
      addEventListener() {}
    },
    Event: FakeEvent,
    HTMLTextAreaElement: class {},
    MutationObserver: class {
      constructor(fn: (records: unknown[]) => void) {
        next.observers.push(fn);
      }
      observe() {}
      disconnect() {
        next.observers.length = 0;
      }
    },
  };
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 3));

function flush() {
  for (let round = 0; round < 20 && env.frames.length; round += 1) for (const fn of env.frames.splice(0)) fn();
}

// Midjourney changed the page (a submit, a route change, the grid loading).
function mutate() {
  for (const fn of [...env.observers]) fn([{ target: env.doc.body }]);
  flush();
}

function loadScript(source: string) {
  new Function(source)();
}

// The copies of the last test retire (their timers would otherwise reach
// this test's page through the shared globals).
function retireAll() {
  if (!env) return;
  env.doc.documentElement.dataset.stgMbInstance = "next-test";
  env.doc.dispatchEvent(new FakeEvent("stg-mb-dock:retire"));
}

async function open(options: { sticky?: unknown; presets?: unknown[] } = {}) {
  retireAll();
  install(makeEnv(options));
  for (const source of SCRIPTS) loadScript(source);
  await tick();
  flush();
  // Michael clicks into the prompt.
  env.area.focus();
  trusted(env.area, "pointerdown", { bubbles: true });
  flush();
  await tick();
  flush();
  return env;
}

function trusted(target: Any, type: string, init: Record<string, unknown> = {}) {
  const event = new FakeEvent(type, init);
  event.isTrusted = true;
  target.dispatchEvent(event);
  return event;
}

// Michael's own typing: beforeinput, the text lands, input.
function type(text: string) {
  trusted(env.area, "keydown", { bubbles: true, key: text[0], code: "KeyA" });
  trusted(env.area, "beforeinput", { bubbles: true, inputType: "insertText", data: text });
  env.area.value += text;
  env.area.setSelectionRange(env.area.value.length, env.area.value.length);
  trusted(env.area, "input", { bubbles: true, inputType: "insertText" });
}

function paste(text: string) {
  trusted(env.area, "beforeinput", { bubbles: true, inputType: "insertFromPaste" });
  env.area.value += text;
  trusted(env.area, "input", { bubbles: true, inputType: "insertFromPaste" });
}

// The queue, Grow or quick edit putting a command in the bar.
function inject(text: string) {
  (globalThis as Any).SaveToGalleryMoodboardDock.holdSticky?.();
  env.area.value = text;
  env.area.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  env.area.dispatchEvent(new FakeEvent("change", { bubbles: true }));
}

// Midjourney sends the job and empties the prompt, with no input event.
function submit() {
  env.area.value = "";
  mutate();
}

function press(code: string, mods: { alt?: boolean; ctrl?: boolean; shift?: boolean } = {}, extra: Record<string, unknown> = {}) {
  const target = (extra.target as Any) || env.doc.activeElement;
  const event = new FakeEvent("keydown", {
    bubbles: true,
    code,
    key: code === "Escape" ? "Escape" : "x",
    altKey: Boolean(mods.alt),
    ctrlKey: Boolean(mods.ctrl),
    shiftKey: Boolean(mods.shift),
    ...extra,
  });
  event.isTrusted = extra.isTrusted === undefined ? true : Boolean(extra.isTrusted);
  target.dispatchEvent(event);
  flush();
  return event;
}

const docks = () => env.doc.querySelectorAll(".stg-mb-dock");
const dock = () => docks()[0]!;
const q = (selector: string) => dock().querySelector(selector)!;
const presetChip = () => q('.stg-mb-preset[data-id="psA"]');
const note = () => q(".stg-mb-note");
const snapshot = () => q(".stg-mb-snap");
const worldMenu = () => q(".stg-mb-wmenu");
const dockShown = () => docks().length === 1 && !dock().hidden;
const FILM = "Shot on 35mm tungsten 500T";

function hoverChip(chip: FakeElement) {
  dock().hover = true;
  chip.hover = true;
  dock().dispatchEvent(new FakeEvent("mouseenter"));
  chip.dispatchEvent(new FakeEvent("mouseenter"));
  flush();
}

/* ── (a) presets apply only when asked, to one prompt ── */

describe("presets apply only when Michael asks, to one prompt", () => {
  test("pressed on an empty prompt: armed (NEXT on the chip), goes into the next typed prompt once", async () => {
    await open();
    expect(dockShown()).toBe(true);
    press("Digit1", { alt: true, ctrl: true });
    expect(presetChip().classList.contains("stg-mb-preset--armed")).toBe(true);
    expect(presetChip().dataset.next).toBe("next");
    expect(note().textContent).toContain("next prompt");
    type("a");
    await tick();
    expect(env.area.value.startsWith("a")).toBe(true);
    expect(env.area.value).toContain("-p m1 p1");
    expect(env.area.value).toContain("--ar 16:9 --s 750");
    expect(env.area.value).toContain(FILM);
    expect(presetChip().classList.contains("stg-mb-preset--armed")).toBe(false);
    submit();
    type("b");
    await tick();
    expect(env.area.value).toBe("b");
  });

  test("a second press ends the arming", async () => {
    await open();
    press("Digit1", { alt: true, ctrl: true });
    press("Digit1", { alt: true, ctrl: true });
    expect(presetChip().classList.contains("stg-mb-preset--armed")).toBe(false);
    type("a");
    await tick();
    expect(env.area.value).toBe("a");
  });

  test("a pasted prompt gets nothing, and the armed preset ends with a note", async () => {
    await open();
    press("Digit1", { alt: true, ctrl: true });
    paste("a tram at dusk --ar 2:3");
    await tick();
    flush();
    expect(env.area.value).toBe("a tram at dusk --ar 2:3");
    expect(presetChip().classList.contains("stg-mb-preset--armed")).toBe(false);
    expect(note().textContent).toContain("was not added");
  });

  test("on a prompt with words it goes into that prompt only; nothing is remembered", async () => {
    await open();
    type("a tram");
    press("Digit1", { alt: true, ctrl: true });
    expect(env.area.value).toContain("-p m1 p1");
    expect(env.area.value).toContain(FILM);
    expect(JSON.stringify(env.local.stgMoodboardSticky)).not.toContain("16:9");
    submit();
    type("b");
    await tick();
    expect(env.area.value).toBe("b");
  });

  test("an old stored preset (settings + packs in the remembered selection) no longer leaks into prompts", async () => {
    await open({ sticky: { "dear-annete": { board: "m2", profiles: ["p3"], params: "--ar 9:16", packs: ["film"] } } });
    type("a");
    await tick();
    expect(env.area.value).toBe("a -p m2 p3");
  });

  test("saving a preset does not arm it for later prompts", async () => {
    await open();
    type("a --ar 4:5");
    q('.stg-mb-chip[data-code="m2"]').dispatchEvent(new FakeEvent("click"));
    expect(env.area.value).toBe("a --ar 4:5 -p m2");
    press("KeyS", { alt: true });
    const input = q(".stg-mb-save-input");
    expect(input.hidden).toBe(false);
    input.value = "Mine";
    press("Enter", {}, { key: "Enter", target: input });
    expect((env.sync["stgMjPresets:dear-annete"] as { name: string }[]).map((entry) => entry.name)).toContain("Mine");
    submit();
    type("c");
    await tick();
    // The chip click is remembered (Michael relies on that); the preset's --ar is not.
    expect(env.area.value).toBe("c -p m2");
  });
});

describe("the remembered board and profiles go into typed prompts only", () => {
  const sticky = { "dear-annete": { board: "m2", profiles: ["p3"] } };

  test("typed: yes", async () => {
    await open({ sticky });
    type("a");
    await tick();
    expect(env.area.value).toBe("a -p m2 p3");
  });

  test("pasted: no", async () => {
    await open({ sticky });
    paste("a finished prompt --ar 1:1");
    await tick();
    expect(env.area.value).toBe("a finished prompt --ar 1:1");
  });

  test("queue / Grow / quick edit text (synthetic input): no", async () => {
    await open({ sticky });
    inject("a queued prompt --v 8.2");
    await tick();
    expect(env.area.value).toBe("a queued prompt --v 8.2");
  });

  test("a prompt Midjourney filled in (Use prompt), then typed into: no", async () => {
    await open({ sticky });
    env.area.value = "reused words";
    mutate();
    type(" more");
    await tick();
    expect(env.area.value).toBe("reused words more");
  });
});

describe("dock keys answer only Michael's own presses", () => {
  test("a synthetic key, a key typed in another box, an input method: nothing", async () => {
    await open();
    type("a");
    press("Digit1", { alt: true }, { isTrusted: false });
    expect(env.area.value).toBe("a");
    press("Digit1", { alt: true }, { target: env.search });
    expect(env.area.value).toBe("a");
    press("Digit1", { alt: true }, { isComposing: true });
    expect(env.area.value).toBe("a");
    press("Digit1", { alt: true });
    expect(env.area.value).toBe("a -p m1");
  });

  test("holding the key runs it once", async () => {
    await open();
    type("a");
    press("Digit1", { alt: true });
    press("Digit1", { alt: true }, { repeat: true });
    press("Digit1", { alt: true }, { repeat: true });
    expect(env.area.value).toBe("a -p m1");
  });
});

/* ── ⌥R reroll ── */

describe("⌥R reroll", () => {
  const codesOf = (value: string) => ((globalThis as Any).SaveToGalleryMoodboardDock.flagCodes(value) as string[]).slice().sort().join(" ");

  test("new codes each press; words and settings stay; the note names the mix; the chips flash", async () => {
    await open();
    type("A tram --ar 3:2");
    let last = "";
    for (let i = 0; i < 12; i += 1) {
      press("KeyR", { alt: true });
      const value = env.area.value;
      expect(value.startsWith("A tram ")).toBe(true);
      expect(value.endsWith("--ar 3:2")).toBe(true);
      const codes = codesOf(value);
      expect(codes).not.toBe(last);
      for (const code of codes.split(" ")) expect(["m1", "m2", "p1", "p2", "p3"]).toContain(code);
      last = codes;
    }
    const flagged = (globalThis as Any).SaveToGalleryMoodboardDock.flagCodes(env.area.value) as string[];
    const names: Record<string, string> = { m1: "Night", m2: "Gold", p1: "CINEMATIC", p2: "DA4", p3: "DA5" };
    const boards = flagged.filter((code) => code.startsWith("m"));
    const profiles = flagged.filter((code) => code.startsWith("p"));
    expect(note().textContent).toBe(`MB+P · ${(globalThis as Any).SaveToGalleryMoodboardDock.mixLabel({ profiles, boards }, names)}`);
    for (const code of flagged) {
      const chip = dock().querySelector(`[data-code="${code}"]`)!;
      expect(chip.classList.contains("stg-mb-flash")).toBe(true);
    }
  });

  test("⌥⇧R is the extreme mix", async () => {
    await open();
    type("A tram");
    press("KeyR", { alt: true, shift: true });
    expect(note().textContent.startsWith("WILD · ")).toBe(true);
  });

  test("on an empty prompt it arms the mix for the next typed prompt", async () => {
    await open();
    press("KeyR", { alt: true });
    expect(note().textContent.startsWith("MB+P · Next prompt · ")).toBe(true);
    const armed = codesOf(q(".stg-mb-active").textContent.replace("next · ", ""));
    type("z");
    await tick();
    expect(env.area.value.startsWith("z -p ")).toBe(true);
    expect(codesOf(env.area.value)).toBe(armed);
  });

  test("the ⟳ Random button does the same; shift-click is extreme", async () => {
    await open();
    type("A tram");
    const button = q(".stg-mb-random");
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe("⟳ Random");
    button.dispatchEvent(new FakeEvent("click"));
    expect(codesOf(env.area.value)).not.toBe("");
    button.dispatchEvent(new FakeEvent("click", { shiftKey: true }));
    expect(note().textContent.startsWith("WILD · ")).toBe(true);
  });
});

/* ── (b) everything the dock shows goes away ── */

describe("the dock's pieces go away", () => {
  test("Esc: the world list, then the hover sheet, then the dock; a click in the prompt brings it back", async () => {
    await open();
    press("KeyW", { alt: true });
    expect(worldMenu().hidden).toBe(false);
    press("Escape");
    expect(worldMenu().hidden).toBe(true);
    expect(dockShown()).toBe(true);
    hoverChip(q('.stg-mb-chip[data-code="m1"]'));
    expect(snapshot().hidden).toBe(false);
    press("Escape");
    expect(snapshot().hidden).toBe(true);
    expect(dockShown()).toBe(true);
    dock().hover = false;
    q('.stg-mb-chip[data-code="m1"]').hover = false;
    press("Escape");
    flush();
    expect(dock().hidden).toBe(true);
    trusted(env.area, "pointerdown", { bubbles: true });
    flush();
    expect(dockShown()).toBe(true);
  });

  test("a click outside closes the world list, the hover sheet and Other worlds", async () => {
    await open();
    q(".stg-mb-others-toggle").dispatchEvent(new FakeEvent("click"));
    flush();
    expect(q(".stg-mb-others").hidden).toBe(false);
    press("KeyW", { alt: true });
    hoverChip(q('.stg-mb-chip[data-code="m1"]'));
    trusted(env.page, "pointerdown", { bubbles: true });
    flush();
    expect(worldMenu().hidden).toBe(true);
    expect(snapshot().hidden).toBe(true);
    expect(q(".stg-mb-others").hidden).toBe(true);
  });

  test("a route change closes everything and folds the dock", async () => {
    await open();
    press("KeyW", { alt: true });
    hoverChip(q('.stg-mb-chip[data-code="m1"]'));
    dock().hover = false;
    q('.stg-mb-chip[data-code="m1"]').hover = false;
    (globalThis as Any).location.href = "https://www.midjourney.com/jobs/abc";
    mutate();
    expect(worldMenu().hidden).toBe(true);
    expect(snapshot().hidden).toBe(true);
    expect(dock().hidden).toBe(true);
  });

  test("leaving the window closes the hover sheet and the world list", async () => {
    await open();
    press("KeyW", { alt: true });
    hoverChip(q('.stg-mb-chip[data-code="m1"]'));
    env.window.dispatchEvent(new FakeEvent("blur"));
    expect(snapshot().hidden).toBe(true);
    expect(worldMenu().hidden).toBe(true);
  });

  test("a hovered preset chip that is redrawn takes its card with it", async () => {
    await open();
    hoverChip(presetChip());
    expect(snapshot().hidden).toBe(false);
    for (const fn of env.storageListeners) {
      fn({ "stgMjPresets:dear-annete": { newValue: [PRESET, { id: "psB", name: "Other", codes: ["m2"] }] } }, "sync");
    }
    expect(snapshot().hidden).toBe(true);
  });

  test("a pointer that left while the tab was away does not keep the dock up", async () => {
    await open();
    hoverChip(q('.stg-mb-chip[data-code="m1"]'));
    // Focus goes to the page; the pointer is gone but no mouseleave came.
    dock().hover = false;
    q('.stg-mb-chip[data-code="m1"]').hover = false;
    env.page.focus();
    env.doc.activeElement = env.doc.body;
    mutate();
    await new Promise((resolve) => setTimeout(resolve, 420));
    mutate();
    expect(dock().hidden).toBe(true);
  });
});

describe("extension reload", () => {
  test("a new copy removes what the old one left, and only one copy answers a key", async () => {
    await open();
    // Leftovers of a much older copy.
    const oldSheet = env.doc.createElement("div");
    oldSheet.className = "stg-mb-snap";
    oldSheet.dataset.stgInstance = "zzzzzz";
    const oldBar = env.doc.createElement("div");
    oldBar.className = "stg-pp-bar";
    env.doc.body.append(oldSheet, oldBar);
    loadScript(DOCK_SCRIPT);
    await tick();
    flush();
    expect(env.doc.querySelectorAll(".stg-pp-bar").length).toBe(0);
    expect(env.doc.querySelectorAll(".stg-mb-snap").every((node) => node.dataset.stgInstance !== "zzzzzz")).toBe(true);
    trusted(env.area, "pointerdown", { bubbles: true });
    flush();
    expect(docks().length).toBe(1);
    type("a");
    await tick();
    press("Digit1", { alt: true });
    // Two copies would add the moodboard and take it out again.
    expect(env.area.value).toBe("a -p m1");
  });

  test("when the extension context dies the dock goes", async () => {
    await open();
    expect(docks().length).toBe(1);
    (env.chrome.runtime as { id?: string }).id = undefined;
    mutate();
    expect(docks().length).toBe(0);
  });
});
