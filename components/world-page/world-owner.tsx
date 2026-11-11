"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCurrentUser } from "@/lib/use-current-user";
import { ASSET_HOTKEYS, LIKE_DOUBLE_MS, assetHotkeyOf, likeLevelOf, type LikeLevel } from "@/lib/asset-hotkeys";
import { heroNotice } from "@/lib/world-hero-inserts";
import { useFrameMarks } from "@/lib/use-frame-marks";
import type { WorldTile } from "./types";
import type { WallOwnerState } from "./world-masonry";

// The owner's keys on the world page and its admin view, on the hovered frame
// (or the one open large). Every key paints before the server answers:
//   1 like (twice quickly: super like, "ready to use") · F feature · H hero
//   (Shift+H pairs into the previous insert) · C comment · 2 drop from the
//   page · D delete (ten minutes to undo) · O open.

declare global {
  interface Window {
    /** Keypress-to-paint times of owner hotkeys on this page, in ms. */
    __worldPageKeyMs?: number[];
  }
}

type Composer = { id: string };

// The note box on a frame and the on-frame confirmation, shared with the
// vault. Owner only, so they stay out of the public page's first load; the
// chunk is fetched as soon as the owner is known.
type OwnerKit = typeof import("@/components/frame-composer/owner-kit");
const loadOwnerKit = () => import("@/components/frame-composer/owner-kit");
const FrameComposer = dynamic(() => loadOwnerKit().then((kit) => kit.FrameComposer), { ssr: false });

/**
 * Where a frame is on screen: open large, else its tile on the page. `part`
 * picks the picture itself (the note box sits on it) or the box around it
 * (a confirmation is painted into it; an <img> cannot hold one).
 */
const frameNodeOf = (id: string, part: "picture" | "box" = "picture"): HTMLElement | null => {
  const key = CSS.escape(id);
  return (
    document.querySelector<HTMLElement>(
      `[data-wp-lightbox="${key}"] ${part === "picture" ? ".wpl-media" : ".wpl-stage"}`,
    ) ?? document.querySelector<HTMLElement>(`[data-wp-id="${key}"]`)
  );
};

export function useWorldOwner({
  slug,
  folderId,
  admin,
  findTile,
  openId,
  onOpenId,
}: {
  slug: string;
  folderId: Id<"folders">;
  admin: boolean;
  /** Any frame on the page by id: the wall's or an insert's. */
  findTile: (id: string) => WorldTile | undefined;
  /** The frame open large, if any. */
  openId: () => string | undefined;
  onOpenId: (id: string) => void;
}) {
  const { user } = useCurrentUser();
  const { isAuthenticated } = useConvexAuth();
  const ownerUserId = user?.ownerUserId;
  const active = Boolean(ownerUserId && isAuthenticated);

  const setStarred = useMutation(api.assets.setAssetStarred);
  const archive = useMutation(api.assetReview.archive);
  const restoreMutation = useMutation(api.assetReview.restore);
  const setHidden = useMutation(api.worldPage.setWorldPageHidden);
  const setHeroInsert = useMutation(api.worldPage.setHeroInsert);
  const addComment = useMutation(api.assetComments.addAssetComment);
  const setLikeLevel = useMutation(api.assets.setAssetLikeLevel);
  // The owner's private marks: super-liked frames and frames with a comment.
  const marks = useFrameMarks(active ? ownerUserId : undefined);
  const heroRows = useQuery(
    api.worldPage.listHeroAssetIds,
    active && ownerUserId ? { ownerUserId } : "skip",
  );

  const [featured, setFeatured] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [heroes, setHeroes] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [drops, setDrops] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [archivedIds, setArchivedIds] = useState<ReadonlySet<string>>(() => new Set());
  // Key 1 on a frame in this visit; it stands over what the page was sent.
  const [likes, setLikes] = useState<ReadonlyMap<string, LikeLevel>>(() => new Map());
  const [flashId, setFlashId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [composer, setComposer] = useState<Composer | null>(null);

  const heroIds = useMemo(
    () => new Set((heroRows ?? []).map((row) => row.assetId as string)),
    [heroRows],
  );
  const superIds = useMemo(() => new Set<string>(marks?.superLiked ?? []), [marks]);
  const notedIds = useMemo(() => new Set<string>(marks?.noted ?? []), [marks]);
  // The page's own read knows a plain like only in the admin view; a super
  // like is known everywhere.
  const likeOf = useCallback(
    (id: string): LikeLevel =>
      likes.get(id) ?? likeLevelOf(findTile(id)?.liked, superIds.has(id)),
    [likes, findTile, superIds],
  );

  // Refs mirror state for the key handler, which is bound once.
  const live = useRef({ featured, heroes, drops, archivedIds, heroIds, composer, likeOf });
  useEffect(() => {
    live.current = { featured, heroes, drops, archivedIds, heroIds, composer, likeOf };
  }, [featured, heroes, drops, archivedIds, heroIds, composer, likeOf]);
  const lookup = useRef({ findTile, openId, onOpenId });
  useEffect(() => {
    lookup.current = { findTile, openId, onOpenId };
  }, [findTile, openId, onOpenId]);

  const ownerKit = useRef<OwnerKit | null>(null);
  // Key 1: the mark paints on the press; the save follows once a double press
  // can no longer come, and whatever still waits is sent on the way out.
  const likePresses = useRef<ReturnType<OwnerKit["createLikePresses"]> | null>(null);
  useEffect(() => {
    if (!active || !ownerUserId) return;
    let gone = false;
    const flush = () => likePresses.current?.flush();
    void loadOwnerKit().then((kit) => {
      if (gone) return;
      ownerKit.current = kit;
      likePresses.current = kit.createLikePresses({
        doubleMs: LIKE_DOUBLE_MS,
        save: (assetId, level) => setLikeLevel({ ownerUserId, assetId: assetId as Id<"assets">, level }),
        onError: (assetId) => {
          setLikes((current) => {
            const copy = new Map(current);
            copy.delete(assetId);
            return copy;
          });
          setNotice("Could not save the like");
        },
      });
    });
    window.addEventListener("pagehide", flush);
    return () => {
      gone = true;
      window.removeEventListener("pagehide", flush);
      flush();
      likePresses.current = null;
    };
  }, [active, ownerUserId, setLikeLevel]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const restore = useCallback(
    (id: string) => {
      if (!ownerUserId) return;
      setArchivedIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      void restoreMutation({ ownerUserId, assetId: id as Id<"assets"> })
        .then(() => setNotice("Restored"))
        .catch(() => setNotice("Could not restore"));
    },
    [ownerUserId, restoreMutation],
  );

  const state = useMemo<WallOwnerState>(() => {
    const offOf = (id: string): WorldTile["off"] => {
      const drop = drops.get(id);
      const off = findTile(id)?.off;
      if (drop === true) return "hidden";
      if (drop === false && off === "hidden") return undefined;
      return off;
    };
    return {
      featured: (id) => featured.get(id) ?? findTile(id)?.featured ?? false,
      archived: (id) => archivedIds.has(id),
      hero: (id) => heroes.get(id) ?? heroIds.has(id),
      off: offOf,
      like: likeOf,
      noted: (id) => notedIds.has(id),
      flashId,
    };
  }, [featured, archivedIds, heroes, heroIds, drops, flashId, findTile, likeOf, notedIds]);

  useEffect(() => {
    if (!active || !ownerUserId) return;
    let pointer: { x: number; y: number } | null = null;
    const move = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
    };
    const markPaint = (startedAt: number) =>
      requestAnimationFrame(() => {
        const ms = performance.now() - startedAt;
        (window.__worldPageKeyMs ??= []).push(Math.round(ms * 10) / 10);
      });
    const keydown = (event: KeyboardEvent) => {
      const key = assetHotkeyOf(event);
      if (!key || key === ASSET_HOTKEYS.scene) return;
      const startedAt = performance.now();
      const id =
        lookup.current.openId() ??
        (pointer
          ? document
              .elementFromPoint(pointer.x, pointer.y)
              ?.closest<HTMLElement>("[data-wp-id]")?.dataset.wpId
          : undefined);
      if (!id) return;
      const tile = lookup.current.findTile(id);
      event.preventDefault();
      event.stopImmediatePropagation();
      // The like paints its own confirmation, in its own colour.
      if (key !== ASSET_HOTKEYS.like) {
        setFlashId(id);
        window.setTimeout(() => setFlashId((current) => (current === id ? null : current)), 650);
      }
      const now = live.current;

      if (key === ASSET_HOTKEYS.like) {
        const kit = ownerKit.current;
        const presses = likePresses.current;
        if (!kit || !presses) return;
        const next = presses.press(id, now.likeOf(id));
        setLikes((current) => new Map(current).set(id, next));
        markPaint(startedAt);
        const said = kit.likeFlash(next);
        kit.flashFrame(frameNodeOf(id, "box"), said.label, said.tone);
      } else if (key === ASSET_HOTKEYS.open) {
        lookup.current.onOpenId(id);
      } else if (key === ASSET_HOTKEYS.comment) {
        // A note already holding words keeps them: the key goes back to it.
        const open = document.querySelector<HTMLTextAreaElement>(".fc textarea");
        if (open?.value.trim()) open.focus({ preventScroll: true });
        else setComposer({ id });
      } else if (key === ASSET_HOTKEYS.feature) {
        const was = now.featured.get(id) ?? tile?.featured ?? false;
        const next = !was;
        setFeatured(new Map(now.featured).set(id, next));
        markPaint(startedAt);
        void setStarred({ ownerUserId, assetId: id as Id<"assets">, starred: next })
          .then(() => setNotice(next ? "Featured · leads the page" : "Unfeatured"))
          .catch(() => {
            setFeatured((current) => new Map(current).set(id, was));
            setNotice("Could not feature");
          });
      } else if (key === ASSET_HOTKEYS.hero) {
        const pair = event.shiftKey;
        const was = now.heroes.get(id) ?? now.heroIds.has(id);
        setHeroes(new Map(now.heroes).set(id, pair ? true : !was));
        markPaint(startedAt);
        void setHeroInsert({
          ownerUserId,
          assetId: id as Id<"assets">,
          folderId,
          action: pair ? "pair" : "toggle",
        })
          .then((result) => {
            const offPage = result.hero && tile?.off;
            setNotice(offPage ? `${heroNotice(result)} · shows once the frame is on the page` : heroNotice(result));
            setHeroes((current) => {
              const copy = new Map(current);
              copy.delete(id);
              return copy;
            });
          })
          .catch(() => {
            setHeroes((current) => new Map(current).set(id, was));
            setNotice("Could not make it a hero");
          });
      } else if (key === ASSET_HOTKEYS.drop) {
        const off = now.drops.get(id) ?? tile?.off === "hidden";
        const next = !off;
        setDrops(new Map(now.drops).set(id, next));
        markPaint(startedAt);
        void setHidden({
          ownerUserId,
          assetIds: [id as Id<"assets">],
          hidden: next,
          reason: next ? "Dropped on the world page (2)" : undefined,
        })
          .then(() => setNotice(next ? "Dropped from the page · 2 brings it back" : "Back on the page"))
          .catch(() => {
            setDrops((current) => new Map(current).set(id, off));
            setNotice("Could not drop it");
          });
      } else if (key === ASSET_HOTKEYS.archive) {
        if (now.archivedIds.has(id)) {
          restore(id);
          return;
        }
        setArchivedIds(new Set(now.archivedIds).add(id));
        markPaint(startedAt);
        void archive({ ownerUserId, assetId: id as Id<"assets"> })
          .then(() => setNotice("Archived · D or double-click restores"))
          .catch(() => {
            setArchivedIds((current) => {
              const copy = new Set(current);
              copy.delete(id);
              return copy;
            });
            setNotice("Could not archive");
          });
      }
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("keydown", keydown, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("keydown", keydown, true);
    };
  }, [active, ownerUserId, folderId, setStarred, setHeroInsert, setHidden, archive, restore]);

  const saveComment = useCallback(
    async (body: string) => {
      if (!ownerUserId || !composer) return false;
      try {
        await addComment({
          ownerUserId,
          assetId: composer.id as Id<"assets">,
          body,
          context: `Comment on the hovered frame of the world page /w/${slug}${admin ? "/admin" : ""}.`,
        });
        ownerKit.current?.flashFrame(frameNodeOf(composer.id, "box"), "Comment saved", "crimson");
        setComposer(null);
        setNotice("Comment saved · your agent picks it up");
        return true;
      } catch {
        setNotice("Could not save the comment");
        return false;
      }
    },
    [ownerUserId, composer, addComment, slug, admin],
  );

  const droppedIds = useMemo(
    () => new Set([...drops].filter(([, dropped]) => dropped).map(([id]) => id)),
    [drops],
  );

  const layer = active ? (
    <>
      <div className="wp-keys" aria-label="Owner keys">
        <span title="1: like · 1 again takes it off"><kbd>1</kbd>Like</span>
        <span title="1 twice, quickly: super like. The image is ready to use."><kbd>1 1</kbd>Super like</span>
        <span><kbd>F</kbd>Feature</span>
        <span><kbd>H</kbd>Hero</span>
        <span><kbd>⇧H</kbd>Pair</span>
        <span><kbd>C</kbd>Comment</span>
        <span><kbd>2</kbd>Drop</span>
        <span><kbd>D</kbd>Delete</span>
        <span><kbd>O</kbd>Open</span>
        <span className="wp-keys-links">
          {admin ? (
            <Link href={`/w/${slug}?public=1`}>Public page</Link>
          ) : (
            <Link href={`/w/${slug}/admin`}>Admin</Link>
          )}
          <Link href={`/w/${slug}`}>Vault</Link>
        </span>
      </div>
      {composer && ownerUserId && (
        <FrameComposer
          key={composer.id}
          frame={() => frameNodeOf(composer.id)}
          assetId={composer.id}
          ownerUserId={ownerUserId}
          skin="world"
          portal={false}
          onSave={saveComment}
          onClose={() => setComposer(null)}
        />
      )}
      {notice && <div className="wp-toast" role="status">{notice}</div>}
    </>
  ) : null;

  return { active, state, archivedIds, droppedIds, restore, layer };
}
