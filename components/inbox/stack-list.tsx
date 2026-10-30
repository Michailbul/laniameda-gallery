"use client";

import { useState } from "react";
import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, ArrowRight, Inbox, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ActionButton, Micro, RADIUS, display, mono } from "./inbox-ui";

type StackRow = FunctionReturnType<typeof api.inbox.listInboxStacks>[number];

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

// A stack is its pictures: a 4:3 mosaic of the first cards, the title over
// the bottom, how far along it is, and one way in.
function StackCard({ row, showWorld }: { row: StackRow; showWorld?: boolean }) {
  const open = row.cards - row.decided;
  const share = row.cards ? row.decided / row.cards : 0;
  const finished = open === 0;
  const previews = row.previewItems.slice(0, 4);
  return <Link href={`/inbox/${row.worldFolderId}/${row._id}`} className="group relative flex flex-col overflow-hidden border transition-[border-color,transform] hover:-translate-y-px hover:border-[var(--lm-coral)]"
    style={{ borderRadius: RADIUS, borderColor: "var(--lm-border)", background: "var(--lm-surface-1)", boxShadow: "var(--lm-shadow-sm)" }}>
    <div className={`relative grid aspect-[4/3] w-full gap-[2px] ${previews.length <= 1 ? "grid-cols-1" : previews.length === 2 ? "grid-cols-2" : "grid-cols-2 grid-rows-2"}`} style={{ background: "var(--lm-border)" }}>
      {previews.length === 0 && <div className="grid place-items-center" style={{ background: "var(--lm-surface-2)" }}><Inbox size={22} style={{ color: "var(--lm-text-ghost)" }} aria-hidden /></div>}
      {previews.map((preview, index) => <div key={`${preview.assetId}-${index}`} className={`relative overflow-hidden ${previews.length === 3 && index === 0 ? "row-span-2" : ""}`} style={{ background: "var(--lm-surface-2)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- card thumbnails */}
        <img src={preview.thumbUrl ?? preview.url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
      </div>)}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 px-4 pb-3 pt-14" style={{ background: "linear-gradient(to top, color-mix(in srgb, var(--lm-paper) 94%, transparent) 30%, transparent)" }}>
        {showWorld && <Micro color="var(--lm-coral)" className="truncate">{row.worldName}</Micro>}
        <p className="text-[17px] font-black uppercase leading-[1.05] tracking-tight" style={{ ...display, textWrap: "balance" }}>{row.title}</p>
      </div>
      <span className="absolute left-3 top-3 px-2 py-[5px] text-[11px] font-black leading-none tabular-nums backdrop-blur" style={{ ...mono, borderRadius: RADIUS, background: finished ? "var(--lm-ink)" : "var(--lm-coral)", color: "var(--lm-paper)" }}>
        {finished ? "Done" : `${open} to decide`}
      </span>
    </div>
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="h-[3px] flex-1" style={{ background: "var(--lm-border)" }}>
        <div className="h-full" style={{ width: `${share * 100}%`, background: finished ? "var(--lm-text-tertiary)" : "var(--lm-coral)" }} />
      </div>
      <span className="text-[11px] font-bold tabular-nums" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>{row.decided}/{row.cards}</span>
      <ActionButton tone={finished ? "ghost" : "ink"} tabIndex={-1} className="pointer-events-none h-9 px-4" icon={<ArrowRight size={12} aria-hidden />}>
        {finished ? "Review" : row.decided ? "Continue" : "Decide"}
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
      : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{stacks.map((row) => <StackCard key={row._id} row={row} showWorld />)}</div>}
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
      : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{stacks.map((row) => <StackCard key={row._id} row={row} />)}</div>}
  </Shell>;
}
