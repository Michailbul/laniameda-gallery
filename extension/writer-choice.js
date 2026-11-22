// Where the writer runs and on which model: one choice for every writer tool
// (Grow, Describe, the quick edit, MJ settings → Writer), kept per Chrome user
// in chrome.storage.sync (writerMode + writerModel).
//
//   local  This Mac: the writer bridge (extension-writer/, `claude -p`).
//   fal    Cloud · fal: the gallery's fal key, fal's OpenRouter route.
//   pika   Cloud · Pika: the gallery's Pika key.
//
// Michael, 22 Nov 2026: "make the extension to pick between local vs cloud
// version of the model to write prompt (pika, fal)". The writer never moves to
// another place by itself: when the chosen one fails (the bridge is down, fal
// or Pika is out of credit), the card says so and offers the other one as one
// click. The models each provider runs mirror lib/writer-models.ts (a test
// keeps them equal).

(function registerWriterChoice(globalScope) {
  const WHERE = [
    { key: "local", short: "MAC", name: "This Mac", hint: "The local writer on this Mac (claude -p). Free, needs the bridge running." },
    { key: "fal", short: "FAL", name: "Cloud · fal", hint: "The gallery's fal key. Needs fal credit." },
    { key: "pika", short: "PIKA", name: "Cloud · Pika", hint: "The gallery's Pika key. Needs Pika credit." },
  ];
  // Per model: the short name on the Mac, and the model each place runs in plain words.
  const MODELS = [
    { key: "haiku", name: "Haiku", vision: true, runs: { local: "Haiku 5.5", fal: "Haiku 5.5", pika: "Haiku 4.5" } },
    { key: "sonnet", name: "Sonnet", vision: true, runs: { local: "Sonnet 5.5", fal: "Sonnet 5.5", pika: "Sonnet 5.5" } },
    { key: "opus", name: "Opus", vision: true, runs: { local: "Opus 5.5", fal: "Opus 5.5", pika: "Opus 5.5" } },
    { key: "fable", name: "Fable", vision: true, runs: { local: "Fable 5.2", fal: "Fable 5.2", pika: "Fable 5.1" } },
    { key: "deepseek", name: "DeepSeek", vision: false, runs: { fal: "DeepSeek V4.1", pika: "DeepSeek V4.1" } },
  ];
  const MODEL_KEYS = MODELS.map((entry) => entry.key);
  const WHERE_KEYS = WHERE.map((entry) => entry.key);

  /** The stored place, read old values too: "cloud" was fal first, "auto" was the Mac when it ran. */
  function modeOf(stored) {
    if (WHERE_KEYS.includes(stored)) return stored;
    if (stored === "cloud") return "fal";
    return "local";
  }
  const modelOf = (stored) => (MODEL_KEYS.includes(stored) ? stored : "haiku");
  const whereOf = (mode) => WHERE.find((entry) => entry.key === mode) || WHERE[0];
  const modelInfo = (model) => MODELS.find((entry) => entry.key === model) || MODELS[0];
  /** Runs there: the Mac runs every Claude model, never DeepSeek. */
  const runsOn = (mode, model) => Boolean(modelInfo(model).runs[modeOf(mode)]);

  /** The words on the picker: "Haiku · Mac", "Cloud · fal · Haiku 5.5", "Cloud · Pika · Haiku 4.5". */
  function label(mode, model) {
    const where = modeOf(mode);
    const info = modelInfo(model);
    if (where === "local") return `${info.name} · Mac`;
    return `${whereOf(where).name} · ${info.runs[where] || info.runs.fal}`;
  }
  /** The model in plain words for a place: "Haiku 4.5". */
  const runs = (mode, model) => modelInfo(model).runs[modeOf(mode)] || "";

  /**
   * The picker's options, grouped by place: [{ group, where, items: [{ value, label, mode, model }] }].
   * vision: only models that read pictures (Grow and Describe send one).
   */
  function groups({ vision = false } = {}) {
    return WHERE.map((where) => ({
      group: where.name,
      where: where.key,
      items: MODELS
        .filter((model) => model.runs[where.key] && (!vision || model.vision))
        .map((model) => ({ value: `${where.key}:${model.key}`, label: label(where.key, model.key), mode: where.key, model: model.key })),
    }));
  }
  /** "pika:sonnet" → { mode: "pika", model: "sonnet" }. */
  function parse(value) {
    const [mode, model] = String(value || "").split(":");
    return { mode: modeOf(mode), model: modelOf(model) };
  }
  const valueOf = (mode, model) => `${modeOf(mode)}:${modelOf(model)}`;

  /** Fill a <select> with the grouped choices and select the current one. */
  function fill(select, status, opts = {}) {
    const mode = modeOf(status?.mode);
    let model = modelOf(status?.model);
    if (opts.vision && !modelInfo(model).vision) model = "haiku";
    if (!runsOn(mode, model)) model = "haiku";
    const current = valueOf(mode, model);
    const doc = select.ownerDocument || document;
    select.replaceChildren(...groups(opts).map((group) => {
      const optgroup = doc.createElement("optgroup");
      optgroup.label = group.group;
      for (const item of group.items) {
        const option = doc.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        option.selected = item.value === current;
        optgroup.appendChild(option);
      }
      return optgroup;
    }));
    select.value = current;
    return current;
  }

  /** The other place to offer when one fails: fal ↔ Pika, and fal when the Mac cannot write. */
  const otherOf = (mode) => (modeOf(mode) === "fal" ? "pika" : "fal");
  /** What a failed call offers: { mode, model, label } or null. */
  function offerFor(res) {
    if (!res || res.ok || !res.where) return null;
    const mode = otherOf(res.where);
    const model = runsOn(mode, res.model) ? modelOf(res.model) : "haiku";
    return { mode, model, label: `Try ${label(mode, model)}` };
  }

  globalScope.SaveToGalleryWriterChoice = {
    WHERE, MODELS, MODEL_KEYS, WHERE_KEYS, modeOf, modelOf, whereOf, modelInfo, runsOn, label, runs, groups, parse, valueOf, fill, otherOf, offerFor,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
