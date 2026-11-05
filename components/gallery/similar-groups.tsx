"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Inbox, Layers, Loader2, MousePointer2, Undo2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { SimilarCluster } from "@/lib/perceptual-hash";

const mono: CSSProperties = { fontFamily: "var(--lm-font)" };
type StackRecord = FunctionReturnType<typeof api.stacks.stackAssets>;
type Status = { tone: "ok" | "error"; text: string; undo?: StackRecord; href?: string };

const errorText = (error: unknown, fallback: string) => {
  const data = (error as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  return error instanceof Error ? error.message.replace(/^.*Uncaught ConvexError: /, "").split("\n")[0] : fallback;
};

function ClusterAction({ icon, children, onClick, disabled, title, busy }: {
  icon: ReactNode; children: ReactNode; onClick: () => void; disabled?: boolean; title?: string; busy?: boolean;
}) {
  return <button type="button" onClick={onClick} disabled={disabled || busy} title={title}
    className="inline-flex items-center gap-1 border px-1.5 py-[3px] text-[9px] font-bold uppercase leading-none tracking-[0.12em] transition-colors hover:border-[var(--lm-coral)] hover:text-[var(--lm-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
    style={{ ...mono, borderRadius: "var(--lm-radius)", borderColor: "var(--lm-border-strong)", color: "var(--lm-text-secondary)" }}>
    {busy ? <Loader2 size={10} className="animate-spin" aria-hidden /> : icon}{children}
  </button>;
}

/**
 * "Group similar": the grid regrouped into clusters of near-identical images
 * (by perceptual hash), largest first, each under a thin divider with its
 * count. From a cluster: stack it under its first image, send it to the
 * world's Inbox as a duplicates card, or select it to move. The rest of the
 * grid follows under "Not grouped".
 */
export function SimilarGroups<T extends { id: string; packId?: string }>({
  ownerUserId, images, clusters, hashedCount, world, renderGrid, onSelect,
}: {
  ownerUserId: string;
  images: T[];
  clusters: SimilarCluster[];
  // How many shown images have a hash yet; the rest cannot group.
  hashedCount: number;
  // The open world, whose Inbox gets duplicates cards.
  world?: { id: string; name: string };
  renderGrid: (entries: T[], last: boolean) => ReactNode;
  onSelect?: (ids: string[]) => void;
}) {
  const stack = useMutation(api.stacks.stackAssets);
  const unstack = useMutation(api.stacks.unstackAssets);
  const post = useMutation(api.inbox.postInboxCards);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  const byId = new Map(images.map((image) => [image.id, image]));
  const grouped = new Set(clusters.flatMap((cluster) => cluster.ids));
  const rest = images.filter((image) => !grouped.has(image.id));

  const run = async (key: string, work: () => Promise<Status>) => {
    setBusy(key);
    try {
      setStatus(await work());
    } catch (error) {
      setStatus({ tone: "error", text: errorText(error, "That did not work.") });
    } finally {
      setBusy(null);
    }
  };

  const stackCluster = (cluster: SimilarCluster, index: number) => run(`stack-${index}`, async () => {
    const record = await stack({ ownerUserId, assetIds: cluster.ids as Id<"assets">[], title: "Similar images" });
    return { tone: "ok", text: `Stacked ${cluster.ids.length} under one cover`, undo: record };
  });

  const sendToInbox = (cluster: SimilarCluster, index: number) => run(`inbox-${index}`, async () => {
    if (!world) throw new Error("Open a world to send to its Inbox.");
    const ids = cluster.ids.slice(0, 8);
    const day = new Date().toISOString().slice(0, 10);
    const result = await post({
      ownerUserId, worldFolderId: world.id as Id<"folders">,
      stackTitle: `Duplicates · Group similar · ${day}`, ingestKey: `group-similar-${day}`, agent: "Group similar",
      cards: [{
        type: "duplicates", key: [...ids].sort().join("+"), assetIds: ids as Id<"assets">[],
        evidence: { matches: [{ kind: "same-hash", label: "perceptual hash distance", score: cluster.maxDistance }] },
      }],
    });
    const skipped = result.skippedKeys.length > 0;
    return {
      tone: "ok", text: skipped ? "Already in the Inbox" : `Sent to ${world.name}'s Inbox${cluster.ids.length > 8 ? " (first 8)" : ""}`,
      href: `/inbox/${world.id}/${result.stackId}`,
    };
  });

  const undoStack = (record: StackRecord) => run("undo", async () => {
    await unstack({ ownerUserId, record });
    return { tone: "ok", text: "Stack undone" };
  });

  return <div className="flex flex-col gap-1">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-1" style={{ ...mono, fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--lm-text-ghost)" }}>
      <span>{clusters.length} {clusters.length === 1 ? "cluster" : "clusters"} · {grouped.size} grouped</span>
      {hashedCount < images.length && <span title="Images saved before hashing, or still being hashed, cannot group yet.">{images.length - hashedCount} not hashed yet</span>}
      {status && <span className="inline-flex items-center gap-2 px-2 py-[3px] normal-case tracking-[0.04em]"
        style={{ borderRadius: "var(--lm-radius)", background: status.tone === "error" ? "var(--lm-coral)" : "var(--lm-ink)", color: "var(--lm-paper)" }}>
        {status.text}
        {status.undo && <button type="button" onClick={() => undoStack(status.undo!)} className="inline-flex items-center gap-1 font-bold uppercase tracking-[0.12em]"><Undo2 size={11} aria-hidden />Undo</button>}
        {status.href && <Link href={status.href} className="font-bold uppercase tracking-[0.12em] underline underline-offset-2">Open</Link>}
        <button type="button" onClick={() => setStatus(null)} aria-label="Dismiss"><X size={11} aria-hidden /></button>
      </span>}
    </div>
    {clusters.map((cluster, index) => {
      const entries = cluster.ids.map((id) => byId.get(id)).filter((entry): entry is T => Boolean(entry));
      return <section key={cluster.ids.join("+")} aria-label={`Similar group of ${entries.length}`} className="mb-2">
        <div className="flex flex-wrap items-center gap-2 px-1 pb-1.5 pt-2" style={{ borderTop: "1px solid var(--lm-border)" }}>
          <span className="text-[10px] font-black uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-primary)" }}>Similar · {entries.length}</span>
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ ...mono, color: "var(--lm-text-ghost)" }}
            title="Largest perceptual-hash difference inside the cluster, in bits of 64">≤ {cluster.maxDistance} bits</span>
          <span className="ml-auto flex flex-wrap gap-1">
            <ClusterAction icon={<Layers size={10} aria-hidden />} busy={busy === `stack-${index}`} onClick={() => void stackCluster(cluster, index)}
              title="Collapse into one stack under the first image; every image stays">Stack</ClusterAction>
            <ClusterAction icon={<Inbox size={10} aria-hidden />} busy={busy === `inbox-${index}`} disabled={!world} onClick={() => void sendToInbox(cluster, index)}
              title={world ? `Send to ${world.name}'s Inbox as a duplicates card` : "Open a world to send to its Inbox"}>To Inbox</ClusterAction>
            {onSelect && <ClusterAction icon={<MousePointer2 size={10} aria-hidden />} onClick={() => onSelect(cluster.ids)} title="Select these to move or file">Select</ClusterAction>}
          </span>
        </div>
        {renderGrid(entries, rest.length === 0 && index === clusters.length - 1)}
      </section>;
    })}
    {rest.length > 0 && <section aria-label="Not grouped">
      {clusters.length > 0 && <div className="px-1 pb-1.5 pt-2" style={{ borderTop: "1px solid var(--lm-border)" }}>
        <span className="text-[10px] font-black uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>Not grouped · {rest.length}</span>
      </div>}
      {renderGrid(rest, true)}
    </section>}
  </div>;
}
