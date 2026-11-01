"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Check, Copy, Loader2, RotateCcw } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  EDIT_MODELS, MAX_SEND_USD, TAKE_CHOICES, estimateEditUsd, formatUsd, liveRoute, planEditSend,
} from "@/lib/edit-models";
import type { EditCompare } from "./before-after-wipe";

const STALE_MS = 20 * 60 * 1000;
const MODELS_KEY = "lm-edit-models";
const TAKES_KEY = "lm-edit-takes";
const draftKey = (assetId: string) => `lm-edit-draft:${assetId}`;

const read = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try { const value = window.localStorage.getItem(key); return value ? (JSON.parse(value) as T) : fallback; } catch { return fallback; }
};
const write = (key: string, value: unknown) => {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
};

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const short = (id: string) => id.slice(-6);

type Ref = { assetId: string; name: string };

/**
 * "Edit in place" for one image (the reviewer kit's edit panel, in the
 * gallery): a prompt, model pills priced for this image on the route each
 * would take now, takes per model, the world's cast attached as references,
 * then every take listed under the source with status, cost and Retry. A
 * landed take opens the before/after wipe on the stage (`onCompare`). Key E
 * focuses the prompt.
 */
export function EditInPlace({
  assetId, ownerUserId, width, height, assetUrl, compare, onCompare, focusSignal = 0, listenForE = true,
}: {
  assetId: string;
  ownerUserId: string;
  width?: number;
  height?: number;
  /** This image's full URL: the "after" when it is itself an edit. */
  assetUrl?: string;
  compare: EditCompare | null;
  onCompare: (compare: EditCompare | null) => void;
  /** Bump to focus the prompt from outside (the Inbox zoom's E). */
  focusSignal?: number;
  /** The detail panel listens for E itself; the Inbox zoom handles it. */
  listenForE?: boolean;
}) {
  const { isAuthenticated } = useConvexAuth();
  const data = useQuery(api.editJobs.listAssetEdits, isAuthenticated ? { ownerUserId, assetId: assetId as Id<"assets"> } : "skip");
  const startEdit = useMutation(api.editJobs.startEdit);
  const retryEdit = useMutation(api.editJobs.retryEdit);

  const [prompt, setPrompt] = useState("");
  const [models, setModels] = useState<string[]>(() => EDIT_MODELS.filter((m) => m.default).map((m) => m.id));
  const [takes, setTakes] = useState(1);
  const [refs, setRefs] = useState<Ref[]>([]);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad?: boolean }>();
  const [retrying, setRetrying] = useState<string>();
  const [copied, setCopied] = useState<string>();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  const focusPrompt = () => {
    sectionRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    promptRef.current?.focus({ preventScroll: true });
  };

  // Saved choices load after mount so the server render matches the first client one.
  useEffect(() => {
    setPrompt(read(draftKey(assetId), ""));
    setModels((current) => read(MODELS_KEY, current));
    setTakes((current) => read(TAKES_KEY, current));
  }, [assetId]);

  useEffect(() => { if (focusSignal) focusPrompt(); }, [focusSignal]);

  useEffect(() => {
    if (!listenForE) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (event.key.toLowerCase() !== "e") return;
      event.preventDefault();
      focusPrompt();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listenForE]);

  const providers = data?.providers;
  const priced = useMemo(() => EDIT_MODELS.map((model) => {
    const { route, blocked } = liveRoute(model, providers);
    const refCount = Math.min(refs.length, model.maxRefs);
    const why = blocked
      ? model.routes.map((r) => `${r.provider}: ${providers?.[r.provider]?.blocked ?? "no key"}`).join(" · ")
      : model.hint + (refs.length > model.maxRefs ? ` Takes ${model.maxRefs} of your ${refs.length} references.` : "");
    return { model, route, blocked, est: estimateEditUsd(route.endpoint, width, height, refCount), why };
  }), [providers, refs.length, width, height]);

  const chosen = priced.filter((entry) => models.includes(entry.model.id));
  const jobCount = chosen.length * takes;
  const total = chosen.reduce((sum, entry) => sum + entry.est, 0) * takes;

  // A take that lands while this panel is open opens the wipe by itself.
  const seen = useRef(new Map<string, string>());
  useEffect(() => {
    if (!data) return;
    let landed: (typeof data.jobs)[number] | undefined;
    for (const job of data.jobs) {
      const before = seen.current.get(job._id);
      if (before && before !== "done" && job.status === "done") landed = job;
      seen.current.set(job._id, job.status);
    }
    if (landed && !compare && landed.resultUrl && assetUrl) {
      onCompare({ jobId: landed._id, beforeUrl: assetUrl, afterUrl: landed.resultUrl, beforeLabel: short(assetId), afterLabel: `${landed.modelName} ${short(landed.resultAssetId ?? landed._id)}` });
    }
  }, [data, compare, assetUrl, assetId, onCompare]);

  const toggleModel = (id: string) => {
    const next = models.includes(id) ? models.filter((entry) => entry !== id) : [...models, id];
    setModels(next); write(MODELS_KEY, next);
  };
  const toggleRef = (ref: Ref) => setRefs((current) =>
    current.some((entry) => entry.assetId === ref.assetId) ? current.filter((entry) => entry.assetId !== ref.assetId) : [...current, ref]);

  const send = async () => {
    const plan = planEditSend({ prompt, modelIds: models, takes, refs: refs.length, width, height });
    if (!plan.ok) { setMessage({ text: plan.error, bad: true }); return; }
    setSending(true); setMessage({ text: "Sending" });
    try {
      const result = await startEdit({
        ownerUserId, assetId: assetId as Id<"assets">, prompt, models, takes,
        refs: refs.map((ref) => ({ assetId: ref.assetId as Id<"assets">, name: ref.name })),
      });
      const dropped = [...new Set(result.jobs.filter((job) => job.refsDropped).map((job) => EDIT_MODELS.find((m) => m.id === job.model)?.name))];
      setMessage({ text: `${result.jobs.length} queued · ≈${formatUsd(result.totalUsd)}${dropped.length ? ` · ${dropped.join(", ")} take fewer references` : ""}` });
      promptRef.current?.blur();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message.replace(/^.*ConvexError: /, "").split("\n")[0]! : "Send failed", bad: true });
    } finally {
      setSending(false);
    }
  };

  const retry = async (jobId: string) => {
    setRetrying(jobId);
    try { await retryEdit({ ownerUserId, jobId: jobId as Id<"editJobs"> }); }
    catch (error) { setMessage({ text: error instanceof Error ? error.message.split("\n")[0]! : "Retry failed", bad: true }); }
    finally { setRetrying(undefined); }
  };

  const copyId = (id: string) => {
    void navigator.clipboard?.writeText(`asset:${id}`);
    setCopied(id); setTimeout(() => setCopied(undefined), 1200);
  };

  const imageMap = refs.length
    ? ["<image-1> this frame", ...refs.map((ref, index) => `<image-${index + 2}> ${ref.name}`)].join(" · ")
    : "";

  return (
    <section ref={sectionRef} className="lm-edit" aria-label="Edit in place">
      <header className="lm-edit-head">
        <span className="lm-edit-title">Edit in place</span>
        <kbd className="lm-edit-kbd" title="Press E to write an edit">E</kbd>
        {data === undefined && isAuthenticated && <Loader2 className="h-3 w-3 animate-spin" style={{ color: "var(--lm-text-ghost)" }} />}
      </header>

      {data?.editOf && (
        <div className="lm-edit-origin">
          <span>Edit of </span>
          <button type="button" className="lm-edit-id" onClick={() => copyId(data.editOf!.job.sourceAssetId)} title="Copy the source's id">
            asset:{short(data.editOf.job.sourceAssetId)}
          </button>
          <span> · {data.editOf.job.modelName} · {data.editOf.job.provider} · {formatUsd(data.editOf.job.chargedUsd ?? data.editOf.job.estimateUsd)}{data.editOf.job.chargedExact ? "" : " est"}</span>
          {data.editOf.sourceUrl && assetUrl && (
            <button type="button" className={`lm-edit-chip${compare?.jobId === data.editOf.job._id ? " on" : ""}`}
              onClick={() => onCompare(compare?.jobId === data.editOf!.job._id ? null : {
                jobId: data.editOf!.job._id, beforeUrl: data.editOf!.sourceUrl!, afterUrl: assetUrl,
                beforeLabel: short(data.editOf!.job.sourceAssetId), afterLabel: short(assetId),
              })}>
              {compare?.jobId === data.editOf.job._id ? "Close wipe" : "Wipe against the source"}
            </button>
          )}
        </div>
      )}

      <textarea
        ref={promptRef}
        rows={3}
        value={prompt}
        onChange={(event) => { setPrompt(event.target.value); write(draftKey(assetId), event.target.value); }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); }
        }}
        placeholder="What to change. Name what stays: the pose, the room, the light, the framing. The frame is <image-1>, characters are <image-2> and on."
        aria-label="Edit prompt"
        className="lm-edit-prompt"
      />

      <div className="lm-edit-models" role="group" aria-label="Models">
        {priced.map(({ model, route, blocked, est, why }) => (
          <button key={model.id} type="button" title={why} aria-pressed={models.includes(model.id)}
            className={`lm-edit-model${models.includes(model.id) ? " on" : ""}${blocked ? " off" : ""}`}
            onClick={() => toggleModel(model.id)}>
            <b>{model.name}</b>
            <span>≈{formatUsd(est)} · {route.provider}{blocked ? " · no credit" : ""}</span>
          </button>
        ))}
      </div>

      {data && data.characters.length > 0 && (
        <div className="lm-edit-cast">
          <span className="lm-edit-label">{data.world?.name ?? "World"} cast · attach as references</span>
          <div className="lm-edit-refs">
            {data.characters.flatMap((character) => character.refs.map((ref) => {
              const name = `${character.name} ${ref.kind}`;
              const on = refs.some((entry) => entry.assetId === ref.assetId);
              return (
                <button key={`${character.id}-${ref.kind}`} type="button" className={`lm-edit-ref${on ? " on" : ""}`}
                  title={`${character.code} · ${name} · asset:${ref.assetId}`} aria-pressed={on}
                  onClick={() => toggleRef({ assetId: ref.assetId, name })}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- small cast thumbnails */}
                  {ref.thumbUrl ? <img src={ref.thumbUrl} alt="" /> : <span className="lm-edit-ref-empty" />}
                  <span>{character.name}<i>{ref.kind}</i></span>
                </button>
              );
            }))}
          </div>
          {imageMap && <p className="lm-edit-map">{imageMap}</p>}
        </div>
      )}

      <div className="lm-edit-send">
        <select value={takes} aria-label="Takes per model" className="lm-edit-takes"
          onChange={(event) => { const n = Number(event.target.value); setTakes(n); write(TAKES_KEY, n); }}>
          {TAKE_CHOICES.map((n) => <option key={n} value={n}>{n} take{n > 1 ? "s" : ""}</option>)}
        </select>
        <button type="button" className="lm-edit-go" disabled={sending || !chosen.length || !prompt.trim()} onClick={() => void send()}
          title={`⌘↩ sends. Refused at $${MAX_SEND_USD} or more.`}>
          {sending ? "Sending" : chosen.length ? `Send ${jobCount > 1 ? `${jobCount} · ` : ""}≈${formatUsd(total)}` : "Pick a model"}
        </button>
        {message && <span className={`lm-edit-msg${message.bad ? " bad" : ""}`} role="status">{message.text}</span>}
      </div>

      {data && data.jobs.length > 0 && (
        <ol className="lm-edit-takes-list">
          {data.jobs.map((job) => {
            const done = job.status === "done" && job.resultUrl;
            const bad = job.status === "error";
            const stale = (job.status === "running" || job.status === "queued") && Date.now() - job.updatedAt > STALE_MS;
            const on = compare?.jobId === job._id;
            const ratio = `${job.width ?? width ?? 16} / ${job.height ?? height ?? 9}`;
            return (
              <li key={job._id} className={`lm-edit-take${on ? " on" : ""}${bad ? " bad" : ""}`}>
                <button type="button" className={`lm-edit-thumb${done ? "" : " pending"}`} style={{ aspectRatio: ratio }}
                  disabled={!done || !assetUrl} title={done ? "Compare before and after" : job.status}
                  onClick={() => done && assetUrl && onCompare(on ? null : {
                    jobId: job._id, beforeUrl: assetUrl, afterUrl: job.resultUrl!,
                    beforeLabel: short(assetId), afterLabel: `${job.modelName} ${short(job.resultAssetId ?? job._id)}`,
                  })}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- the landed take */}
                  {done && <img src={job.resultThumbUrl ?? job.resultUrl} alt="" />}
                </button>
                <div className="lm-edit-meta">
                  <div className="lm-edit-meta-top">
                    <b>{job.modelName}{job.of > 1 ? ` · ${job.take}/${job.of}` : ""}</b>
                    {job.resultAssetId && (
                      <button type="button" className="lm-edit-id" onClick={() => copyId(job.resultAssetId!)} title="Copy the edit's id">
                        {copied === job.resultAssetId ? <Check size={10} aria-hidden /> : <Copy size={10} aria-hidden />}
                        {short(job.resultAssetId)}
                      </button>
                    )}
                  </div>
                  <div className="lm-edit-status" title={job.tried.join("\n")}>
                    <span>{job.provider}{job.refNames.length ? ` · refs ${job.refNames.join(", ")}` : ""}{job.createdBy === "agent" ? " · agent" : ""}</span>
                    {done ? <span className="ok">{formatUsd(job.chargedUsd)}{job.chargedExact ? "" : " est"}</span>
                      : bad ? <span className="err">{job.error}</span>
                      : <span className="run">{stale ? "stalled" : job.status === "queued" ? "queued" : "running"}… ≈{formatUsd(job.estimateUsd)}</span>}
                  </div>
                  {(bad || stale) && (
                    <button type="button" className="lm-edit-retry" disabled={retrying === job._id} onClick={() => void retry(job._id)}>
                      <RotateCcw size={10} aria-hidden />{retrying === job._id ? "Retrying" : "Retry"}
                    </button>
                  )}
                  <q>{job.prompt}</q>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
