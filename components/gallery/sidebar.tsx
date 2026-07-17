"use client";

import Image from "next/image";

import { useMemo, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Film,
  FolderOpen,
  Globe,
  Home,
  Layers,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  LayoutGrid,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TelegramLoginButton } from "@/components/telegram-login-button";
import {
  hasAssetDragPayload,
  readAssetDragPayload,
} from "@/lib/asset-drag";

interface ModelTag {
  name: string;
  usageCount: number;
}

interface User {
  email?: string | null;
  firstName?: string | null;
  username?: string | null;
  photoUrl?: string | null;
}

interface Folder {
  _id: string;
  name: string;
  count?: number;
  /** Set when this collection is nested inside another (one level deep). */
  parentFolderId?: string;
}

interface GallerySidebarProps {
  modelTags: ModelTag[];
  hideModelsSection?: boolean;
  selectedModelName: string | null;
  onModelSelect: (name: string | null) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onUploadClick: () => void;
  onSeedanceClick?: () => void;
  /** Opens the dedicated Storybooks masonry tab. */
  onStorybooksTab?: () => void;
  storybooksTabActive?: boolean;
  /** Clears any tab overlay and returns to the asset gallery. */
  onGalleryHome?: () => void;
  user?: User | null;
  onSignOut?: () => void;
  imageCount?: number;
  folders?: Folder[];
  selectedFolderId?: string | null;
  onFolderSelect?: (folderId: string | null) => void;
  /** When set, collection rows accept dragged gallery assets as drop targets. */
  onAssetsDropOnFolder?: (folderId: string, assetIds: string[]) => void;
  /** Storybook collections — rows open the storybook modal instead of filtering. */
  storybooks?: Folder[];
  onStorybookOpen?: (storybookId: string) => void;
  onCreateStorybook?: (name: string) => Promise<string | null>;
  /** Dropping assets on a storybook ADDS them (keeps existing collections). */
  onAssetsDropOnStorybook?: (storybookId: string, assetIds: string[]) => void;
  /** Projects — rows open the fullscreen review workspace. */
  projects?: ProjectEntry[];
  /** The project whose review workspace is currently open, if any. */
  activeProjectId?: string | null;
  onProjectOpen?: (projectId: string) => void;
  onCreateProject?: (name: string) => Promise<string | null>;
  /** Dropping assets on a project files them into its Inbox direction. */
  onAssetsDropOnProject?: (projectId: string, assetIds: string[]) => void;
  /** Dropping assets on a direction ADDS them to that collection. */
  onAssetsDropOnDirection?: (directionId: string, assetIds: string[]) => void;
  /** Manage any folder-backed row (collection / storybook / project). */
  onRenameFolder?: (folderId: string, name: string) => Promise<void> | void;
  /** Deletes the folder; its assets stay in the gallery. */
  onDeleteFolder?: (folderId: string) => Promise<void> | void;
  /** Folder ids currently published to the public "My Taste" showcase. */
  showcasedFolderIds?: Set<string>;
  /** Toggle a collection / storybook onto or off the public showcase. */
  onToggleShowcase?: (folderId: string, next: boolean) => void;
  /** Folder ids featured (hero treatment) on the public showcase home. */
  featuredFolderIds?: Set<string>;
  /** Toggle featured; featuring an unpublished set also publishes it. */
  onToggleFeatured?: (folderId: string, next: boolean) => void;
  /** Create a sub-collection inside a root collection. */
  onCreateSubCollection?: (
    parentFolderId: string,
    name: string,
  ) => Promise<string | null>;
  /** Opens the public showcase as a visitor sees it (owner preview). */
  onPreviewShowcase?: () => void;
}

interface ProjectEntry extends Folder {
  /** Member directions (collections), for expandable drop targets. */
  directions?: { id: string; name: string }[];
}

export function GallerySidebar({
  modelTags,
  hideModelsSection = false,
  selectedModelName,
  onModelSelect,
  collapsed,
  onCollapsedChange,
  onUploadClick,
  onSeedanceClick,
  onStorybooksTab,
  storybooksTabActive = false,
  onGalleryHome,
  user,
  onSignOut,
  imageCount,
  folders = [],
  selectedFolderId,
  onFolderSelect,
  onAssetsDropOnFolder,
  storybooks = [],
  onStorybookOpen,
  onCreateStorybook,
  onAssetsDropOnStorybook,
  projects = [],
  activeProjectId,
  onProjectOpen,
  onCreateProject,
  onAssetsDropOnProject,
  onAssetsDropOnDirection,
  onRenameFolder,
  onDeleteFolder,
  showcasedFolderIds,
  onToggleShowcase,
  featuredFolderIds,
  onToggleFeatured,
  onCreateSubCollection,
  onPreviewShowcase,
}: GallerySidebarProps) {
  const pathname = usePathname();
  const isGalleryActive = pathname === "/";

  const [creatingStorybook, setCreatingStorybook] = useState(false);
  const [storybookDraft, setStorybookDraft] = useState("");
  const [storybookBusy, setStorybookBusy] = useState(false);

  const submitStorybookDraft = async () => {
    const name = storybookDraft.trim();
    if (!name || !onCreateStorybook || storybookBusy) return;
    setStorybookBusy(true);
    try {
      const storybookId = await onCreateStorybook(name);
      if (storybookId) {
        setCreatingStorybook(false);
        setStorybookDraft("");
        onStorybookOpen?.(storybookId);
      }
    } finally {
      setStorybookBusy(false);
    }
  };

  const [creatingProject, setCreatingProject] = useState(false);
  const [projectDraft, setProjectDraft] = useState("");
  const [projectBusy, setProjectBusy] = useState(false);

  // Inline sub-collection create: which root collection is being added to.
  const [subCreateFor, setSubCreateFor] = useState<string | null>(null);
  const [subDraft, setSubDraft] = useState("");
  const [subBusy, setSubBusy] = useState(false);

  const submitSubDraft = async () => {
    const name = subDraft.trim();
    if (!name || !onCreateSubCollection || !subCreateFor || subBusy) return;
    setSubBusy(true);
    try {
      const folderId = await onCreateSubCollection(subCreateFor, name);
      if (folderId) {
        setSubCreateFor(null);
        setSubDraft("");
      }
    } finally {
      setSubBusy(false);
    }
  };

  // Collections arrive flat; group sub-collections under their parent. A
  // child whose parent isn't in the list (filtered out) renders at root.
  const { rootFolders, childrenByParent } = useMemo(() => {
    const ids = new Set(folders.map((folder) => folder._id));
    const roots: Folder[] = [];
    const children = new Map<string, Folder[]>();
    for (const folder of folders) {
      if (folder.parentFolderId && ids.has(folder.parentFolderId)) {
        const list = children.get(folder.parentFolderId) ?? [];
        list.push(folder);
        children.set(folder.parentFolderId, list);
      } else {
        roots.push(folder);
      }
    }
    return { rootFolders: roots, childrenByParent: children };
  }, [folders]);

  const submitProjectDraft = async () => {
    const name = projectDraft.trim();
    if (!name || !onCreateProject || projectBusy) return;
    setProjectBusy(true);
    try {
      // createProject opens the review workspace itself.
      const projectId = await onCreateProject(name);
      if (projectId) {
        setCreatingProject(false);
        setProjectDraft("");
      }
    } finally {
      setProjectBusy(false);
    }
  };

  const sidebarWidth = collapsed
    ? "var(--lm-sidebar-collapsed)"
    : "var(--lm-sidebar-width)";

  const sortedModels = useMemo(
    () =>
      [...modelTags].sort((a, b) => {
        const usageDiff = b.usageCount - a.usageCount;
        if (usageDiff !== 0) return usageDiff;
        return a.name.localeCompare(b.name);
      }),
    [modelTags],
  );

  const focusFilterBar = () => {
    if (typeof window === "undefined") return;
    const target = document.getElementById("gallery-filter-bar");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <aside
      className="lm-liquid-glass-sidebar fixed left-0 top-0 z-40 flex h-dvh flex-col overflow-hidden"
      style={{
        width: sidebarWidth,
        transition: `width var(--lm-duration-normal) ease-out`,
        fontFamily: "var(--lm-font)",
      }}
    >
      {/* Header: Logo */}
      <div
        className="flex flex-shrink-0 items-center"
        style={{
          height: "60px",
          padding: collapsed ? "0" : "0 18px",
          justifyContent: collapsed ? "center" : "space-between",
          borderBottom: "1px solid var(--lm-sidebar-divider)",
        }}
      >
        {!collapsed && (
          <div className="flex select-none items-center gap-0">
            <span className="lm-glass-logo-letter">LANIA</span>
            <span
              className="mx-1.5 inline-block"
              style={{
                width: "7px",
                height: "7px",
                background:
                  "linear-gradient(135deg, var(--lm-coral) 0%, rgba(255, 122, 100, 0.65) 100%)",
                transform: "rotate(45deg)",
                flexShrink: 0,
                boxShadow: "0 0 8px rgba(255, 122, 100, 0.45)",
                borderRadius: "1px",
              }}
            />
            <span className="lm-glass-logo-letter">MEDA</span>
          </div>
        )}

        {collapsed && (
          <button
            type="button"
            onClick={() => onCollapsedChange(false)}
            className="group flex h-full w-full items-center justify-center"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <span
              className="group-hover:hidden"
              style={{
                width: "10px",
                height: "10px",
                background:
                  "linear-gradient(135deg, var(--lm-coral) 0%, rgba(255, 122, 100, 0.65) 100%)",
                transform: "rotate(45deg)",
                flexShrink: 0,
                boxShadow: "0 0 10px rgba(255, 122, 100, 0.5)",
                borderRadius: "1px",
              }}
            />
            <ChevronRight
              className="hidden h-4 w-4 group-hover:block"
              style={{ color: "var(--lm-coral)" }}
            />
          </button>
        )}

        {!collapsed && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onCollapsedChange(true)}
              className="lm-glass-icon-btn"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div
        className="flex flex-col py-1"
        style={{ borderBottom: "1px solid var(--lm-sidebar-divider)" }}
      >
        <NavItem
          icon={Home}
          label="Gallery"
          href="/"
          active={isGalleryActive && !storybooksTabActive}
          collapsed={collapsed}
          onClick={onGalleryHome}
        />
        <NavItem
          icon={Search}
          label="Search"
          href="#"
          active={false}
          collapsed={collapsed}
          onClick={focusFilterBar}
        />
        <NavItem
          icon={Plus}
          label="Upload"
          href="#"
          active={false}
          collapsed={collapsed}
          onClick={onUploadClick}
        />
        {onStorybooksTab && (
          <NavItem
            icon={BookOpen}
            label="Storybooks"
            href="#"
            active={storybooksTabActive}
            collapsed={collapsed}
            onClick={onStorybooksTab}
          />
        )}
        {onSeedanceClick && (
          <NavItem
            icon={Film}
            label="Seedance"
            href="#"
            active={false}
            collapsed={collapsed}
            onClick={onSeedanceClick}
          />
        )}
        {onPreviewShowcase && (
          <NavItem
            icon={Globe}
            label="Taste profile"
            href="#"
            active={false}
            collapsed={collapsed}
            onClick={onPreviewShowcase}
          />
        )}
      </div>

      {/* Scrollable content */}
      <ScrollArea className="flex-1">
        {!collapsed && (
          <div className="flex flex-col">
            {/* Storybooks — narrative image sets. Rows open the storybook
                modal; they never act as grid filters. */}
            {onStorybookOpen &&
              (storybooks.length > 0 || Boolean(onCreateStorybook)) && (
                <div
                  style={{
                    borderBottom: "1px solid var(--lm-sidebar-divider)",
                  }}
                >
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span
                      style={{
                        fontSize: "8px",
                        fontWeight: 800,
                        textTransform: "uppercase",
                        letterSpacing: "0.20em",
                        color: "var(--lm-sidebar-text-ghost)",
                      }}
                    >
                      STORYBOOKS
                    </span>
                    {onCreateStorybook && (
                      <button
                        type="button"
                        onClick={() => {
                          setCreatingStorybook((prev) => !prev);
                          setStorybookDraft("");
                        }}
                        aria-label="New storybook"
                        title="New storybook"
                        style={{ color: "var(--lm-coral)" }}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  {creatingStorybook && (
                    <div className="px-4 pb-2.5">
                      <input
                        autoFocus
                        value={storybookDraft}
                        disabled={storybookBusy}
                        onChange={(event) =>
                          setStorybookDraft(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void submitStorybookDraft();
                          }
                          if (event.key === "Escape") {
                            setCreatingStorybook(false);
                            setStorybookDraft("");
                          }
                        }}
                        placeholder="Storybook name"
                        className="w-full bg-transparent pb-1 outline-none"
                        style={{
                          fontSize: "10px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.10em",
                          color: "var(--lm-sidebar-text)",
                          borderBottom: "1px solid var(--lm-coral)",
                          caretColor: "var(--lm-coral)",
                          opacity: storybookBusy ? 0.5 : 1,
                        }}
                      />
                    </div>
                  )}
                  {storybooks.map((storybook) => (
                    <FilterRow
                      key={storybook._id}
                      icon={BookOpen}
                      label={storybook.name}
                      count={storybook.count}
                      active={false}
                      onClick={() => onStorybookOpen(storybook._id)}
                      onDropAssets={
                        onAssetsDropOnStorybook
                          ? (assetIds) =>
                              onAssetsDropOnStorybook(storybook._id, assetIds)
                          : undefined
                      }
                      onRename={
                        onRenameFolder
                          ? (name) => onRenameFolder(storybook._id, name)
                          : undefined
                      }
                      onDelete={
                        onDeleteFolder
                          ? () => onDeleteFolder(storybook._id)
                          : undefined
                      }
                      showcased={showcasedFolderIds?.has(storybook._id)}
                      onToggleShowcase={
                        onToggleShowcase
                          ? (next) => onToggleShowcase(storybook._id, next)
                          : undefined
                      }
                      featured={featuredFolderIds?.has(storybook._id)}
                      onToggleFeatured={
                        onToggleFeatured
                          ? (next) => onToggleFeatured(storybook._id, next)
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}

            {/* Projects — review workspaces that group collections. Rows open
                the fullscreen review modal; they never act as grid filters. */}
            {onProjectOpen &&
              (projects.length > 0 || Boolean(onCreateProject)) && (
                <div
                  style={{
                    borderBottom: "1px solid var(--lm-sidebar-divider)",
                  }}
                >
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span
                      style={{
                        fontSize: "8px",
                        fontWeight: 800,
                        textTransform: "uppercase",
                        letterSpacing: "0.20em",
                        color: "var(--lm-sidebar-text-ghost)",
                      }}
                    >
                      PROJECTS
                    </span>
                    {onCreateProject && (
                      <button
                        type="button"
                        onClick={() => {
                          setCreatingProject((prev) => !prev);
                          setProjectDraft("");
                        }}
                        aria-label="New project"
                        title="New project"
                        style={{ color: "var(--lm-coral)" }}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  {creatingProject && (
                    <div className="px-4 pb-2.5">
                      <input
                        autoFocus
                        value={projectDraft}
                        disabled={projectBusy}
                        onChange={(event) =>
                          setProjectDraft(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void submitProjectDraft();
                          }
                          if (event.key === "Escape") {
                            setCreatingProject(false);
                            setProjectDraft("");
                          }
                        }}
                        placeholder="Project name"
                        className="w-full bg-transparent pb-1 outline-none"
                        style={{
                          fontSize: "10px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.10em",
                          color: "var(--lm-sidebar-text)",
                          borderBottom: "1px solid var(--lm-coral)",
                          caretColor: "var(--lm-coral)",
                          opacity: projectBusy ? 0.5 : 1,
                        }}
                      />
                    </div>
                  )}
                  {projects.map((project) => (
                    <ProjectRow
                      key={project._id}
                      project={project}
                      active={project._id === activeProjectId}
                      onOpen={() => onProjectOpen(project._id)}
                      onDropAssets={
                        onAssetsDropOnProject
                          ? (assetIds) =>
                              onAssetsDropOnProject(project._id, assetIds)
                          : undefined
                      }
                      onDropAssetsOnDirection={onAssetsDropOnDirection}
                      onRename={
                        onRenameFolder
                          ? (name) => onRenameFolder(project._id, name)
                          : undefined
                      }
                      onDelete={
                        onDeleteFolder
                          ? () => onDeleteFolder(project._id)
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}

            {/* Folders — dashboard.tsx controls which folders are passed in
                per scope (all owned collections for "mine", a curated
                public-facing allowlist for "public"), so no scope gate here. */}
            {folders.length > 0 && onFolderSelect && (
              <div style={{ borderBottom: "1px solid var(--lm-sidebar-divider)" }}>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span
                    style={{
                      fontSize: "8px",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.20em",
                      color: "var(--lm-sidebar-text-ghost)",
                    }}
                  >
                    COLLECTIONS
                  </span>
                  {selectedFolderId && (
                    <button
                      type="button"
                      onClick={() => onFolderSelect(null)}
                      style={{
                        fontSize: "8px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.12em",
                        color: "var(--lm-coral)",
                      }}
                    >
                      CLEAR
                    </button>
                  )}
                </div>
                <FilterRow
                  icon={FolderOpen}
                  label="All collections"
                  active={
                    selectedFolderId === null ||
                    selectedFolderId === undefined
                  }
                  onClick={() => onFolderSelect(null)}
                />
                {rootFolders.map((folder) => (
                  <div key={folder._id}>
                    <FilterRow
                      label={folder.name}
                      count={folder.count}
                      active={selectedFolderId === folder._id}
                      onClick={() =>
                        onFolderSelect(
                          selectedFolderId === folder._id ? null : folder._id,
                        )
                      }
                      onDropAssets={
                        onAssetsDropOnFolder
                          ? (assetIds) =>
                              onAssetsDropOnFolder(folder._id, assetIds)
                          : undefined
                      }
                      onRename={
                        onRenameFolder
                          ? (name) => onRenameFolder(folder._id, name)
                          : undefined
                      }
                      onDelete={
                        onDeleteFolder
                          ? () => onDeleteFolder(folder._id)
                          : undefined
                      }
                      showcased={showcasedFolderIds?.has(folder._id)}
                      onToggleShowcase={
                        onToggleShowcase
                          ? (next) => onToggleShowcase(folder._id, next)
                          : undefined
                      }
                      featured={featuredFolderIds?.has(folder._id)}
                      onToggleFeatured={
                        onToggleFeatured
                          ? (next) => onToggleFeatured(folder._id, next)
                          : undefined
                      }
                      onAddSub={
                        onCreateSubCollection
                          ? () => {
                              setSubCreateFor((prev) =>
                                prev === folder._id ? null : folder._id,
                              );
                              setSubDraft("");
                            }
                          : undefined
                      }
                    />
                    {subCreateFor === folder._id && (
                      <div className="pb-2.5 pl-9 pr-4">
                        <input
                          autoFocus
                          value={subDraft}
                          disabled={subBusy}
                          onChange={(event) => setSubDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              void submitSubDraft();
                            }
                            if (event.key === "Escape") {
                              setSubCreateFor(null);
                              setSubDraft("");
                            }
                          }}
                          placeholder={`Inside ${folder.name}`}
                          className="w-full bg-transparent pb-1 outline-none"
                          style={{
                            fontSize: "10px",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.10em",
                            color: "var(--lm-sidebar-text)",
                            borderBottom: "1px solid var(--lm-coral)",
                            caretColor: "var(--lm-coral)",
                            opacity: subBusy ? 0.5 : 1,
                          }}
                          aria-label={`New sub-collection inside ${folder.name}`}
                        />
                      </div>
                    )}
                    {(childrenByParent.get(folder._id) ?? []).map((child) => (
                      <FilterRow
                        key={child._id}
                        indent
                        label={child.name}
                        count={child.count}
                        active={selectedFolderId === child._id}
                        onClick={() =>
                          onFolderSelect(
                            selectedFolderId === child._id ? null : child._id,
                          )
                        }
                        onDropAssets={
                          onAssetsDropOnFolder
                            ? (assetIds) =>
                                onAssetsDropOnFolder(child._id, assetIds)
                            : undefined
                        }
                        onRename={
                          onRenameFolder
                            ? (name) => onRenameFolder(child._id, name)
                            : undefined
                        }
                        onDelete={
                          onDeleteFolder
                            ? () => onDeleteFolder(child._id)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* Models — suppressed entirely when hideModelsSection (e.g. cinema pillar) */}
            {!hideModelsSection && sortedModels.length > 0 && (
              <div style={{ borderBottom: "1px solid var(--lm-sidebar-divider)" }}>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span
                    style={{
                      fontSize: "8px",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.20em",
                      color: "var(--lm-sidebar-text-ghost)",
                    }}
                  >
                    MODELS
                  </span>
                  {selectedModelName && (
                    <button
                      type="button"
                      onClick={() => onModelSelect(null)}
                      style={{
                        fontSize: "8px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.12em",
                        color: "var(--lm-coral)",
                      }}
                    >
                      CLEAR
                    </button>
                  )}
                </div>
                <FilterRow
                  icon={LayoutGrid}
                  label="All models"
                  active={selectedModelName === null}
                  onClick={() => onModelSelect(null)}
                />
                {sortedModels.map((model) => (
                  <FilterRow
                    key={model.name}
                    label={model.name}
                    count={model.usageCount}
                    active={selectedModelName === model.name}
                    onClick={() =>
                      onModelSelect(
                        selectedModelName === model.name ? null : model.name,
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Bottom: Stats + Profile */}
      <div className="flex flex-col mt-auto">
        {/* Stats grid */}
        {!collapsed && (
          <div
            className="grid grid-cols-2"
            style={{ borderTop: "1px solid var(--lm-sidebar-divider)" }}
          >
            <div
              className="px-4 py-3"
              style={{ borderRight: "1px solid var(--lm-sidebar-divider)" }}
            >
              <p
                style={{
                  fontSize: "28px",
                  fontWeight: 900,
                  color: "var(--lm-sidebar-text)",
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {imageCount != null ? imageCount : "--"}
              </p>
              <p
                className="mt-1"
                style={{
                  fontSize: "8px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.20em",
                  color: "var(--lm-sidebar-text-ghost)",
                }}
              >
                IMAGES
              </p>
            </div>
            <div className="px-4 py-3">
              <p
                style={{
                  fontSize: "28px",
                  fontWeight: 900,
                  color: "var(--lm-sidebar-text)",
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {modelTags.length}
              </p>
              <p
                className="mt-1"
                style={{
                  fontSize: "8px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.20em",
                  color: "var(--lm-sidebar-text-ghost)",
                }}
              >
                MODELS
              </p>
            </div>
          </div>
        )}

        {/* Collapsed stats */}
        {collapsed && (
          <div
            className="flex flex-col items-center px-1 py-3"
            style={{ borderTop: "1px solid var(--lm-sidebar-divider)" }}
          >
            <p
              style={{
                fontSize: "18px",
                fontWeight: 900,
                color: "var(--lm-sidebar-text)",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {imageCount != null ? imageCount : "--"}
            </p>
            <p
              className="mt-0.5"
              style={{
                fontSize: "7px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                color: "var(--lm-sidebar-text-ghost)",
              }}
            >
              IMG
            </p>
          </div>
        )}

        {/* Profile */}
        <div
          className="px-3 py-3"
          style={{ borderTop: "1px solid var(--lm-sidebar-divider)" }}
        >
          {user ? (
            collapsed ? (
              <div className="flex justify-center">
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    backgroundColor: "var(--lm-success)",
                    borderRadius: "var(--lm-radius)",
                  }}
                />
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                {user.photoUrl ? (
                  <Image
                    src={user.photoUrl}
                    alt=""
                    width={28}
                    height={28}
                    unoptimized
                    style={{
                      borderRadius: "999px",
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: "28px",
                      height: "28px",
                      backgroundColor: "transparent",
                      border: "1px solid var(--lm-sidebar-glass-border)",
                      borderRadius: "999px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "11px",
                      fontWeight: 900,
                      color: "var(--lm-sidebar-text)",
                    }}
                  >
                    {(user.firstName ?? user.username ?? "U").charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span
                    className="truncate"
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.10em",
                      color: "var(--lm-sidebar-text)",
                    }}
                  >
                    {user.username
                      ? `@${user.username}`
                      : user.email ?? user.firstName ?? "USER"}
                  </span>
                  <span
                    style={{
                      fontSize: "8px",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      color: "var(--lm-success)",
                    }}
                  >
                    ONLINE
                  </span>
                </div>
                {onSignOut && (
                  <button
                    type="button"
                    onClick={onSignOut}
                    aria-label="Sign out"
                    title="Sign out"
                    className="lm-sidebar-text-link shrink-0"
                  >
                    sign out
                  </button>
                )}
              </div>
            )
          ) : collapsed ? (
            <div className="flex justify-center">
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  backgroundColor: "var(--lm-sidebar-text-ghost)",
                  borderRadius: "var(--lm-radius)",
                }}
              />
            </div>
          ) : (
            <TelegramLoginButton size="small" />
          )}
        </div>
      </div>
    </aside>
  );
}

/* Nav Item */

function NavItem({
  icon: Icon,
  label,
  href,
  active,
  collapsed,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  href: string;
  active: boolean;
  collapsed: boolean;
  onClick?: () => void;
}) {
  const inner = (
    <div
      className="flex w-full items-center"
      style={{
        padding: collapsed ? "12px 0" : "11px 16px",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: collapsed ? "0" : "12px",
      }}
    >
      <Icon
        className="h-4 w-4 flex-shrink-0"
        style={{
          color: active
            ? "var(--lm-coral)"
            : "var(--lm-sidebar-text-ghost)",
          transition: "color var(--lm-duration-fast) ease-out",
        }}
      />
      {!collapsed && (
        <span
          style={{
            fontSize: "10px",
            fontWeight: active ? 800 : 600,
            textTransform: "uppercase",
            letterSpacing: "0.16em",
          }}
        >
          {label}
        </span>
      )}
    </div>
  );

  const sharedClass = "lm-glass-nav-item cursor-pointer";

  // A real route ("/") renders a Link so navigation still works; an onClick, if
  // present, also fires (e.g. Gallery resets any active tab overlay). The "#"
  // sentinel means "no route" — render a plain button.
  if (href && href !== "#") {
    return (
      <Link
        href={href}
        className={`${sharedClass} block`}
        data-active={active ? "true" : "false"}
        title={collapsed ? label : undefined}
        onClick={onClick}
      >
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={sharedClass}
      data-active={active ? "true" : "false"}
      onClick={onClick}
      title={collapsed ? label : undefined}
    >
      {inner}
    </button>
  );
}

/* Project row — expandable, with per-direction drop targets. Dropping on the
   project itself files assets into its Inbox direction; hovering a drag over
   the row auto-expands it so a direction can be targeted directly. */

function ProjectRow({
  project,
  active = false,
  onOpen,
  onDropAssets,
  onDropAssetsOnDirection,
  onRename,
  onDelete,
}: {
  project: ProjectEntry;
  /** True while this project's review workspace is open. */
  active?: boolean;
  onOpen: () => void;
  onDropAssets?: (assetIds: string[]) => void;
  onDropAssetsOnDirection?: (directionId: string, assetIds: string[]) => void;
  onRename?: (name: string) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const directions = project.directions ?? [];
  const droppable = Boolean(onDropAssets);

  const commitRename = () => {
    const name = (renameDraft ?? "").trim();
    setRenameDraft(null);
    if (!name || name === project.name || !onRename) return;
    void onRename(name);
  };

  return (
    <div>
      <button
        type="button"
        onClick={renameDraft !== null ? undefined : onOpen}
        className="group lm-glass-filter-row cursor-pointer"
        data-active={active ? "true" : "false"}
        onPointerLeave={() => setDeleteArmed(false)}
        onDragOver={
          droppable
            ? (event) => {
                if (!hasAssetDragPayload(event.dataTransfer)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOver(true);
                if (directions.length > 0) setExpanded(true);
              }
            : undefined
        }
        onDragLeave={droppable ? () => setDragOver(false) : undefined}
        onDrop={
          droppable
            ? (event) => {
                setDragOver(false);
                if (!hasAssetDragPayload(event.dataTransfer)) return;
                event.preventDefault();
                const assetIds = readAssetDragPayload(event.dataTransfer);
                if (assetIds.length > 0) onDropAssets!(assetIds);
              }
            : undefined
        }
        style={
          dragOver
            ? {
                backgroundColor: "rgba(255, 122, 100, 0.14)",
                boxShadow: "inset 0 0 0 2px var(--lm-coral)",
                borderRadius: "8px",
              }
            : undefined
        }
        title={
          droppable
            ? "Open review — drop assets to file them into this project's Inbox"
            : "Open review"
        }
      >
        <Layers
          className="h-3 w-3 flex-shrink-0"
          style={{
            color: active ? "var(--lm-coral)" : "var(--lm-sidebar-text-ghost)",
            transition: "color var(--lm-duration-fast)",
          }}
        />
        {renameDraft !== null ? (
          <input
            autoFocus
            value={renameDraft}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setRenameDraft(null);
              }
            }}
            onBlur={commitRename}
            className="min-w-0 flex-1 bg-transparent text-left outline-none"
            style={{
              fontSize: "10px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.10em",
              color: "var(--lm-sidebar-text)",
              borderBottom: "1px solid var(--lm-coral)",
              caretColor: "var(--lm-coral)",
            }}
            aria-label={`Rename ${project.name}`}
          />
        ) : (
          <span
            className="min-w-0 flex-1 truncate text-left"
            style={{
              fontSize: "10px",
              fontWeight: active ? 700 : 500,
              textTransform: "uppercase",
              letterSpacing: "0.10em",
            }}
          >
            {project.name}
          </span>
        )}
        {project.count !== undefined && renameDraft === null && (
          <span
            className={
              onRename || onDelete ? "group-hover:hidden" : undefined
            }
            style={{
              fontSize: "9px",
              fontVariantNumeric: "tabular-nums",
              color: "var(--lm-sidebar-text-ghost)",
            }}
          >
            {project.count}
          </span>
        )}
        {(onRename || onDelete) && renameDraft === null && (
          <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
            {onRename && (
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  setRenameDraft(project.name);
                }}
                className="flex h-4 w-4 items-center justify-center"
                style={{ color: "var(--lm-sidebar-text-ghost)" }}
                aria-label={`Rename ${project.name}`}
                title="Rename project"
              >
                <Pencil className="h-2.5 w-2.5" />
              </span>
            )}
            {onDelete && (
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!deleteArmed) {
                    setDeleteArmed(true);
                    return;
                  }
                  setDeleteArmed(false);
                  void onDelete();
                }}
                className="flex h-4 items-center justify-center gap-0.5 px-0.5"
                style={{
                  color: deleteArmed
                    ? "var(--lm-coral)"
                    : "var(--lm-sidebar-text-ghost)",
                }}
                aria-label={
                  deleteArmed
                    ? `Confirm delete ${project.name}`
                    : `Delete ${project.name}`
                }
                title={
                  deleteArmed
                    ? "Click again to delete — directions and assets survive"
                    : "Delete project (directions and assets survive)"
                }
              >
                <Trash2 className="h-2.5 w-2.5" />
                {deleteArmed && (
                  <span
                    style={{
                      fontSize: "8px",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    sure?
                  </span>
                )}
              </span>
            )}
          </span>
        )}
        {directions.length > 0 && (
          <span
            role="button"
            tabIndex={-1}
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((prev) => !prev);
            }}
            aria-label={expanded ? "Collapse directions" : "Expand directions"}
            className="flex h-4 w-4 flex-shrink-0 items-center justify-center"
            style={{ color: "var(--lm-sidebar-text-ghost)" }}
          >
            <ChevronRight
              className="h-3 w-3 transition-transform"
              style={{ transform: expanded ? "rotate(90deg)" : undefined }}
            />
          </span>
        )}
      </button>

      {expanded &&
        directions.map((direction) => (
          <DirectionDropRow
            key={direction.id}
            name={direction.name}
            onClick={onOpen}
            onDropAssets={
              onDropAssetsOnDirection
                ? (assetIds) => onDropAssetsOnDirection(direction.id, assetIds)
                : undefined
            }
          />
        ))}
    </div>
  );
}

function DirectionDropRow({
  name,
  onClick,
  onDropAssets,
}: {
  name: string;
  onClick: () => void;
  onDropAssets?: (assetIds: string[]) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      className="lm-glass-filter-row cursor-pointer"
      data-active="false"
      onDragOver={
        onDropAssets
          ? (event) => {
              if (!hasAssetDragPayload(event.dataTransfer)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragOver(true);
            }
          : undefined
      }
      onDragLeave={onDropAssets ? () => setDragOver(false) : undefined}
      onDrop={
        onDropAssets
          ? (event) => {
              setDragOver(false);
              if (!hasAssetDragPayload(event.dataTransfer)) return;
              event.preventDefault();
              const assetIds = readAssetDragPayload(event.dataTransfer);
              if (assetIds.length > 0) onDropAssets(assetIds);
            }
          : undefined
      }
      style={{
        paddingLeft: "26px",
        ...(dragOver
          ? {
              backgroundColor: "rgba(255, 122, 100, 0.14)",
              boxShadow: "inset 0 0 0 2px var(--lm-coral)",
              borderRadius: "8px",
            }
          : {}),
      }}
      title={onDropAssets ? "Drop assets to add to this direction" : undefined}
    >
      <FolderOpen
        className="h-3 w-3 flex-shrink-0"
        style={{ color: "var(--lm-sidebar-text-ghost)" }}
      />
      <span
        className="min-w-0 flex-1 truncate text-left"
        style={{
          fontSize: "10px",
          fontWeight: 500,
          letterSpacing: "0.06em",
        }}
      >
        {name}
      </span>
    </button>
  );
}

/* Filter Row */

function FilterRow({
  icon: Icon,
  label,
  count,
  active,
  onClick,
  onDropAssets,
  onRename,
  onDelete,
  showcased = false,
  onToggleShowcase,
  featured = false,
  onToggleFeatured,
  onAddSub,
  indent = false,
}: {
  icon?: React.ElementType;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  /** When set, the row accepts dragged gallery assets. */
  onDropAssets?: (assetIds: string[]) => void;
  /** When set, the row shows hover manage controls. */
  onRename?: (name: string) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  /** True when this row is published to the public showcase. */
  showcased?: boolean;
  /** When set, the row shows a public/showcase toggle. */
  onToggleShowcase?: (next: boolean) => void;
  /** True when this row is featured (hero) on the showcase home. */
  featured?: boolean;
  /** When set, the row shows a feature toggle (implies publishing). */
  onToggleFeatured?: (next: boolean) => void;
  /** When set, the row shows an add-sub-collection control. */
  onAddSub?: () => void;
  /** Renders as a nested sub-collection row. */
  indent?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  // Two-step delete: first click arms, second executes; leaving disarms.
  const [deleteArmed, setDeleteArmed] = useState(false);
  const manageable = Boolean(
    onRename || onDelete || onToggleShowcase || onToggleFeatured || onAddSub,
  );

  const commitRename = () => {
    const name = (renameDraft ?? "").trim();
    setRenameDraft(null);
    if (!name || name === label || !onRename) return;
    void onRename(name);
  };

  return (
    <button
      type="button"
      onClick={renameDraft !== null ? undefined : onClick}
      className="group lm-glass-filter-row cursor-pointer"
      data-active={active ? "true" : "false"}
      onPointerLeave={() => setDeleteArmed(false)}
      onDragOver={
        onDropAssets
          ? (event) => {
              if (!hasAssetDragPayload(event.dataTransfer)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragOver(true);
            }
          : undefined
      }
      onDragLeave={onDropAssets ? () => setDragOver(false) : undefined}
      onDrop={
        onDropAssets
          ? (event) => {
              setDragOver(false);
              if (!hasAssetDragPayload(event.dataTransfer)) return;
              event.preventDefault();
              const assetIds = readAssetDragPayload(event.dataTransfer);
              if (assetIds.length > 0) onDropAssets(assetIds);
            }
          : undefined
      }
      style={{
        ...(indent ? { paddingLeft: "34px" } : {}),
        ...(dragOver
          ? {
              backgroundColor: "rgba(255, 122, 100, 0.14)",
              boxShadow: "inset 0 0 0 2px var(--lm-coral)",
              borderRadius: "8px",
            }
          : {}),
      }}
    >
      {Icon ? (
        <Icon
          className="h-3 w-3 flex-shrink-0"
          style={{
            color: active
              ? "var(--lm-coral)"
              : "var(--lm-sidebar-text-ghost)",
            transition: "color var(--lm-duration-fast)",
          }}
        />
      ) : null}
      {renameDraft !== null ? (
        <input
          autoFocus
          value={renameDraft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setRenameDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commitRename();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setRenameDraft(null);
            }
          }}
          onBlur={commitRename}
          className="min-w-0 flex-1 bg-transparent text-left outline-none"
          style={{
            fontSize: "10px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.10em",
            color: "var(--lm-sidebar-text)",
            borderBottom: "1px solid var(--lm-coral)",
            caretColor: "var(--lm-coral)",
          }}
          aria-label={`Rename ${label}`}
        />
      ) : (
        <span
          className="min-w-0 flex-1 truncate text-left"
          style={{
            fontSize: "10px",
            fontWeight: active ? 700 : 500,
            textTransform: "uppercase",
            letterSpacing: "0.10em",
          }}
        >
          {label}
        </span>
      )}
      {featured && renameDraft === null && (
        <Star
          className={`h-2.5 w-2.5 flex-shrink-0 ${manageable ? "group-hover:hidden" : ""}`}
          style={{ color: "var(--lm-coral)", fill: "var(--lm-coral)" }}
          aria-label="Featured on showcase"
        />
      )}
      {showcased && !featured && renameDraft === null && (
        <Globe
          className={`h-2.5 w-2.5 flex-shrink-0 ${manageable ? "group-hover:hidden" : ""}`}
          style={{ color: "var(--lm-coral)" }}
          aria-label="Public on showcase"
        />
      )}
      {count !== undefined && renameDraft === null && (
        <span
          className={manageable ? "group-hover:hidden" : undefined}
          style={{
            fontSize: "9px",
            fontVariantNumeric: "tabular-nums",
            color: active
              ? "var(--lm-coral)"
              : "var(--lm-sidebar-text-ghost)",
            fontWeight: 700,
          }}
        >
          {count}
        </span>
      )}
      {manageable && renameDraft === null && (
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          {onAddSub && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onAddSub();
              }}
              className="flex h-4 w-4 items-center justify-center"
              style={{ color: "var(--lm-sidebar-text-ghost)" }}
              aria-label={`New sub-collection inside ${label}`}
              title="New sub-collection"
            >
              <Plus className="h-2.5 w-2.5" />
            </span>
          )}
          {onToggleFeatured && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFeatured(!featured);
              }}
              className="flex h-4 w-4 items-center justify-center"
              style={{
                color: featured
                  ? "var(--lm-coral)"
                  : "var(--lm-sidebar-text-ghost)",
              }}
              aria-label={
                featured ? `Unfeature ${label}` : `Feature ${label} on showcase`
              }
              title={
                featured
                  ? "Featured on your showcase — click to unfeature"
                  : "Feature on your showcase home (publishes it too)"
              }
            >
              <Star
                className="h-2.5 w-2.5"
                style={featured ? { fill: "var(--lm-coral)" } : undefined}
              />
            </span>
          )}
          {onToggleShowcase && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onToggleShowcase(!showcased);
              }}
              className="flex h-4 w-4 items-center justify-center"
              style={{
                color: showcased
                  ? "var(--lm-coral)"
                  : "var(--lm-sidebar-text-ghost)",
              }}
              aria-label={showcased ? `Unpublish ${label}` : `Publish ${label} to showcase`}
              title={
                showcased
                  ? "Public on your showcase — click to unpublish"
                  : "Publish to your public showcase"
              }
            >
              <Globe className="h-2.5 w-2.5" />
            </span>
          )}
          {onRename && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                setRenameDraft(label);
              }}
              className="flex h-4 w-4 items-center justify-center"
              style={{ color: "var(--lm-sidebar-text-ghost)" }}
              aria-label={`Rename ${label}`}
              title="Rename"
            >
              <Pencil className="h-2.5 w-2.5" />
            </span>
          )}
          {onDelete && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                if (!deleteArmed) {
                  setDeleteArmed(true);
                  return;
                }
                setDeleteArmed(false);
                void onDelete();
              }}
              className="flex h-4 items-center justify-center gap-0.5 px-0.5"
              style={{
                color: deleteArmed
                  ? "var(--lm-coral)"
                  : "var(--lm-sidebar-text-ghost)",
              }}
              aria-label={
                deleteArmed
                  ? `Confirm delete ${label}`
                  : `Delete ${label}`
              }
              title={
                deleteArmed
                  ? "Click again to delete — assets stay in the gallery"
                  : "Delete (assets stay in the gallery)"
              }
            >
              <Trash2 className="h-2.5 w-2.5" />
              {deleteArmed && (
                <span
                  style={{
                    fontSize: "8px",
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  sure?
                </span>
              )}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
