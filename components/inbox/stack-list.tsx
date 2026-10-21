"use client";

import { useState } from "react";
import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, ArrowRight, Inbox, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { INBOX_CARD_LABEL } from "@/lib/inbox";
import { ActionButton, Micro, RADIUS, display, mono } from "./inbox-ui";

type StackRow = FunctionReturnType<typeof api.inbox.listInboxStacks>[number];

const ago = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function Shell({ back, title, subtitle, actions, children }: {
  back: { href: string; label: string }; title: string; subtitle: string; actions?: React.ReactNode; children: React.ReactNode;
}) {
  return <main className="min-h-dvh px-4 pb-16 md:px-8" style={{ background: "var(--lm-paper)", color: "var(--lm-text-primary)", paddingTop: "max(16px, env(safe-area-inset-top))" }}>
    <div className="mx-auto max-w-5xl">
      <Link href={back.href} className="mb-6 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors hover:text-[var(--lm-text-primary)]"
        style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
        <ArrowLeft size={13} aria-hidden /> {back.label}
      </Link>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-4xl font-black uppercase leading-none tracking-tight md:text-5xl" style={display}>{title}</h1>
          <p className="mt-2 text-[11px] uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>{subtitle}</p>
        </div>
        {actions}
      </header>
      {children}
    </div>
  </main>;
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="border px-6 py-16 text-center" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border)", borderStyle: "dashed" }}>
    <Inbox size={22} className="mx-auto" style={{ color: "var(--lm-text-ghost)" }} aria-hidden />
    <p className="mt-3 text-sm font-black uppercase tracking-tight" style={display}>{title}</p>
    <p className="mx-auto mt-2 max-w-sm text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>{children}</p>
  </div>;
}

const Spinner = () => <div className="grid place-items-center py-24"><Loader2 className="animate-spin" size={18} style={{ color: "var(--lm-text-ghost)" }} aria-label="Loading" /></div>;

function StackCard({ row, showWorld }: { row: StackRow; showWorld?: boolean }) {
  const open = row.cards - row.decided;
  const share = row.cards ? row.decided / row.cards : 0;
  const finished = open === 0;
  return <Link href={`/inbox/${row.worldFolderId}/${row._id}`} className="group flex flex-col border transition-[border-color,transform] hover:-translate-y-px"
    style={{ borderRadius: RADIUS, borderColor: "var(--lm-border)", background: "var(--lm-surface-1)", boxShadow: "var(--lm-shadow-sm)" }}>
    <div className="flex gap-3 p-3">
      <div className="grid h-[92px] w-[92px] shrink-0 grid-cols-2 grid-rows-2 gap-[2px] overflow-hidden" style={{ borderRadius: RADIUS, background: "var(--lm-surface-2)" }}>
        {row.previewItems.slice(0, 4).map((preview, index) => <div key={`${preview.assetId}-${index}`}
          className={row.previewItems.length === 1 ? "col-span-2 row-span-2" : row.previewItems.length === 3 && index === 0 ? "row-span-2" : ""}>
          {/* eslint-disable-next-line @next/next/no-img-element -- card thumbnails */}
          <img src={preview.thumbUrl ?? preview.url} alt="" loading="lazy" className="h-full w-full object-cover" />
        </div>)}
      </div>
      <div className="min-w-0 flex-1">
        {showWorld && <Micro color="var(--lm-coral)" className="mb-1 block truncate">{row.worldName}</Micro>}
        <p className="truncate text-[14px] font-black uppercase leading-tight tracking-tight" style={display}>{row.title}</p>
        {row.note && <p className="mt-1 line-clamp-2 text-[13px] leading-5" style={{ color: "var(--lm-text-secondary)" }}>{row.note}</p>}
        <Micro color="var(--lm-text-ghost)" className="mt-1.5 block truncate">{[row.agent, ago(row.createdAt)].filter(Boolean).join(" · ")}</Micro>
      </div>
    </div>
    <div className="flex flex-wrap gap-1.5 px-3">
      {row.cardTypes.map((type) => <span key={type} className="border px-1.5 py-[3px] text-[10px] font-bold uppercase leading-none tracking-[0.1em]"
        style={{ ...mono, borderRadius: RADIUS, borderColor: "var(--lm-border)", color: "var(--lm-text-secondary)" }}>{INBOX_CARD_LABEL[type]}</span>)}
    </div>
    <div className="mt-3 flex items-center gap-3 border-t px-3 py-2.5" style={{ borderColor: "var(--lm-border)" }}>
      <span className="text-[12px] font-bold tabular-nums" style={mono}>
        {String(row.decided).padStart(2, "0")}<span style={{ color: "var(--lm-text-ghost)" }}> / {String(row.cards).padStart(2, "0")}</span>
      </span>
      <div className="h-[3px] flex-1" style={{ background: "var(--lm-border)" }}>
        <div className="h-full" style={{ width: `${share * 100}%`, background: finished ? "var(--lm-text-tertiary)" : "var(--lm-coral)" }} />
      </div>
      <ActionButton tone={finished ? "ghost" : "ink"} tabIndex={-1} className="pointer-events-none py-1.5" icon={<ArrowRight size={12} aria-hidden />}>
        {finished ? "Review" : row.decided ? "Continue" : "Start"}
      </ActionButton>
    </div>
  </Link>;
}

function StatusChips({ status, setStatus }: { status: "open" | "closed"; setStatus: (value: "open" | "closed") => void }) {
  return <div className="flex gap-2" role="group" aria-label="Stack status">
    {(["open", "closed"] as const).map((value) => <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)}
      className="lm-chip" data-active={status === value ? "true" : undefined} style={{ borderRadius: RADIUS }}>
      {value === "open" ? "Open" : "Closed"}
    </button>)}
  </div>;
}

/** /inbox: every world with decisions waiting, then all open stacks. */
export function InboxHome({ ownerUserId }: { ownerUserId: string }) {
  const { isAuthenticated } = useConvexAuth();
  const [status, setStatus] = useState<"open" | "closed">("open");
  const worlds = useQuery(api.inbox.listInboxWorlds, isAuthenticated ? { ownerUserId } : "skip");
  const stacks = useQuery(api.inbox.listInboxStacks, isAuthenticated ? { ownerUserId, status } : "skip");
  const waiting = worlds?.reduce((sum, row) => sum + row.openCards, 0) ?? 0;
  return <Shell back={{ href: "/", label: "Gallery" }} title="Decisions"
    subtitle={worlds === undefined ? "Loading…" : `${plural(waiting, "card")} waiting · ${plural(worlds.length, "world")}`}
    actions={<StatusChips status={status} setStatus={setStatus} />}>
    {worlds && worlds.length > 0 && status === "open" && <div className="mb-6 flex flex-wrap gap-2">
      {worlds.map((world) => <Link key={world.worldFolderId} href={`/inbox/${world.worldFolderId}`}
        className="inline-flex items-center gap-2 border px-3 py-2 transition-colors hover:border-[var(--lm-coral)]"
        style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)", background: "var(--lm-surface-1)" }}>
        <span className="text-[12px] font-black uppercase tracking-tight" style={display}>{world.worldName}</span>
        <span className="px-1.5 py-[2px] text-[10px] font-bold tabular-nums" style={{ ...mono, borderRadius: RADIUS, background: world.openCards ? "var(--lm-coral)" : "var(--lm-surface-3)", color: "var(--lm-paper)" }}>{world.openCards}</span>
      </Link>)}
    </div>}
    {stacks === undefined ? <Spinner /> : stacks.length === 0
      ? <Empty title={status === "open" ? "Nothing to decide" : "No closed stacks"}>Agents post stacks of cards into a world&rsquo;s Inbox with post_inbox_cards. You decide; they apply and learn.</Empty>
      : <div className="grid gap-3 md:grid-cols-2">{stacks.map((row) => <StackCard key={row._id} row={row} showWorld />)}</div>}
  </Shell>;
}

/** /inbox/<world>: that world's stacks, newest first. */
export function WorldInbox({ ownerUserId, worldId }: { ownerUserId: string; worldId: string }) {
  const { isAuthenticated } = useConvexAuth();
  const [status, setStatus] = useState<"open" | "closed">("open");
  const stacks = useQuery(api.inbox.listInboxStacks, isAuthenticated ? { ownerUserId, status, worldFolderId: worldId as Id<"folders"> } : "skip");
  const folders = useQuery(api.inbox.listInboxWorlds, isAuthenticated ? { ownerUserId } : "skip");
  const worldName = stacks?.[0]?.worldName ?? folders?.find((row) => row.worldFolderId === worldId)?.worldName ?? "World";
  const waiting = (stacks ?? []).reduce((sum, row) => sum + row.cards - row.decided, 0);
  return <Shell back={{ href: "/inbox", label: "All decisions" }} title={worldName}
    subtitle={stacks === undefined ? "Loading…" : status === "open" ? `Inbox · ${plural(stacks.length, "stack")} · ${plural(waiting, "card")} waiting` : `Inbox · ${plural(stacks.length, "closed stack")}`}
    actions={<StatusChips status={status} setStatus={setStatus} />}>
    {stacks === undefined ? <Spinner /> : stacks.length === 0
      ? <Empty title={status === "open" ? "Inbox empty" : "No closed stacks"}>Nothing waits for you in this world.</Empty>
      : <div className="grid gap-3 md:grid-cols-2">{stacks.map((row) => <StackCard key={row._id} row={row} />)}</div>}
  </Shell>;
}
