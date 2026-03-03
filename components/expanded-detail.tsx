"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  ArrowRight,
  Paintbrush,
  Move,
  UserRound,
  Trash2,
  Copy,
  Download,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Link as LinkIcon,
  Package,
} from "lucide-react";
import { formatAssetCreatedAt, resolvePillarLabel } from "@/lib/gallery-focus";
import { downloadImage } from "@/lib/download-image";

type ModalIntent = "transfer_style" | "transfer_pose" | "replace_character";

type DetailTab = "prompt" | "details" | "actions";
const NO_FOLDER_VALUE = "__none";

interface ExpandedDetailProps {
  image: {
    id: string;
    thumbSrc: string;
    fullSrc: string;
    prompt: string;
    width?: number;
    height?: number;
    modelName?: string;
    pillar?: string;
    tagNames?: string[];
    sourceUrl?: string;
    createdAt?: number;
    folderId?: string;
    isPublic?: boolean;
    isFeatured?: boolean;
  };
  onClose: () => void;
  onAction: (intent: ModalIntent, imageId: string) => void;
  activeRunId?: string;
  onOpenRun?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  canGoPrev?: boolean;
  canGoNext?: boolean;
  imagePosition?: string;
  onDelete?: (imageId: string) => void;
  deleting?: boolean;
  deleteError?: string;
  canCuratePublic?: boolean;
  onSetPublicState?: (imageId: string, isPublic: boolean) => void;
  onSetFeaturedState?: (imageId: string, isFeatured: boolean) => void;
  curationBusy?: boolean;
  curationError?: string;
  folders?: Array<{ _id: string; name: string }>;
  canManageFolder?: boolean;
  onSetFolder?: (imageId: string, folderId: string | null) => Promise<void> | void;
  onCreateFolder?: (name: string) => Promise<string | null>;
  folderBusy?: boolean;
  folderError?: string;
}

const ACTIONS = [
  { intent: "transfer_style" as ModalIntent, label: "Transfer Style", icon: Paintbrush },
  { intent: "transfer_pose" as ModalIntent, label: "Transfer Pose", icon: Move },
  { intent: "replace_character" as ModalIntent, label: "Replace Character", icon: UserRound },
];

const TABS: { id: DetailTab; label: string }[] = [
  { id: "prompt", label: "Prompt" },
  { id: "details", label: "Details" },
  { id: "actions", label: "Actions" },
];

export function ExpandedDetail({
  image,
  onClose,
  onAction,
  activeRunId,
  onOpenRun,
  onPrev,
  onNext,
  canGoPrev,
  canGoNext,
  imagePosition,
  onDelete,
  deleting = false,
  deleteError,
  canCuratePublic = false,
  onSetPublicState,
  onSetFeaturedState,
  curationBusy = false,
  curationError,
  folders = [],
  canManageFolder = false,
  onSetFolder,
  onCreateFolder,
  folderBusy = false,
  folderError,
}: ExpandedDetailProps) {
  const [fullLoaded, setFullLoaded] = useState(false);
  const { modelName, tagNames } = image;
  const [copied, setCopied] = useState(false);
  const [copiedLabel, setCopiedLabel] = useState("Copied");
  const [downloadStarted, setDownloadStarted] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("prompt");
  const [folderDraftName, setFolderDraftName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastExiting, setToastExiting] = useState(false);
  const tabListRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const copyMenuRef = useRef<HTMLDivElement>(null);

  // Reset states on image change
  useEffect(() => {
    setFullLoaded(false);
    setPromptExpanded(false);
    setCopyMenuOpen(false);
    setToastVisible(false);
    setToastExiting(false);
    setFolderDraftName("");
    setCreatingFolder(false);
  }, [image.id]);

  // Click-outside to close copy dropdown
  useEffect(() => {
    if (!copyMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (copyMenuRef.current && !copyMenuRef.current.contains(e.target as Node)) {
        setCopyMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [copyMenuOpen]);

  const showToast = useCallback((label: string) => {
    setCopied(true);
    setCopiedLabel(label);
    setCopyMenuOpen(false);
    setToastVisible(true);
    setToastExiting(false);
    setTimeout(() => {
      setToastExiting(true);
      setTimeout(() => {
        setToastVisible(false);
        setToastExiting(false);
        setCopied(false);
      }, 200);
    }, 1800);
  }, []);

  const handleCopy = async (text?: string) => {
    await navigator.clipboard.writeText(text ?? image.prompt);
    showToast("Prompt copied");
  };

  const handleCopyUrl = async () => {
    await navigator.clipboard.writeText(image.fullSrc);
    showToast("URL copied");
  };

  const handleCopyPackage = async () => {
    const parts = [
      image.prompt,
      image.modelName ? `Model: ${image.modelName}` : "",
      image.pillar ? `Pillar: ${image.pillar}` : "",
      image.tagNames?.length ? `Tags: ${image.tagNames.join(", ")}` : "",
      `Image: ${image.fullSrc}`,
      image.sourceUrl ? `Source: ${image.sourceUrl}` : "",
    ].filter(Boolean);
    await navigator.clipboard.writeText(parts.join("\n"));
    showToast("Package copied");
  };

  const handleDownload = async () => {
    setDownloadStarted(true);
    await downloadImage(image.fullSrc, `laniameda-${image.id}`);
    setTimeout(() => setDownloadStarted(false), 1500);
  };

  const handleFolderChange = (value: string) => {
    if (!onSetFolder) return;
    const nextFolderId = value === NO_FOLDER_VALUE ? null : value;
    void onSetFolder(image.id, nextFolderId);
  };

  const handleCreateFolder = async () => {
    if (!onCreateFolder) return;
    const name = folderDraftName.trim();
    if (!name || creatingFolder) return;

    setCreatingFolder(true);
    try {
      const folderId = await onCreateFolder(name);
      if (folderId && onSetFolder) {
        await onSetFolder(image.id, folderId);
      }
      setFolderDraftName("");
    } finally {
      setCreatingFolder(false);
    }
  };

  // Keyboard: Cmd+C copies prompt when panel focused and no text selected
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
          e.preventDefault();
          void handleCopy();
        }
      }
    };
    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.prompt]);

  const isLongPrompt = image.prompt.length > 220;
  const pillarLabel = useMemo(() => resolvePillarLabel(image.pillar), [image.pillar]);
  const createdAtLabel = useMemo(
    () => formatAssetCreatedAt(image.createdAt),
    [image.createdAt],
  );
  const relativeDate = useMemo(() => {
    if (!image.createdAt) return undefined;
    const diff = Date.now() - image.createdAt;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return undefined; // fall back to full date in details tab
  }, [image.createdAt]);

  // Tab keyboard navigation (ARIA roving tabindex)
  const activeTabIndex = TABS.findIndex((t) => t.id === activeTab);
  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let newIndex = activeTabIndex;
      if (e.key === "ArrowRight") {
        newIndex = (activeTabIndex + 1) % TABS.length;
      } else if (e.key === "ArrowLeft") {
        newIndex = (activeTabIndex - 1 + TABS.length) % TABS.length;
      } else {
        return;
      }
      e.preventDefault();
      setActiveTab(TABS[newIndex].id);
      const tabList = tabListRef.current;
      if (tabList) {
        const buttons = tabList.querySelectorAll<HTMLButtonElement>("[role=tab]");
        buttons[newIndex]?.focus();
      }
    },
    [activeTabIndex],
  );

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="flex h-full flex-col gap-3 p-4 animate-panel-slide-in"
      key={image.id}
    >
      {/* Header: nav strip + close */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {onPrev && (
            <button
              type="button"
              onClick={onPrev}
              disabled={!canGoPrev}
              className="interactive-surface flex h-7 w-7 items-center justify-center rounded-lg disabled:opacity-30"
              style={{ color: "var(--text-tertiary)" }}
              aria-label="Previous image"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {imagePosition && (
            <span
              className="px-1 text-[11px] tabular-nums"
              style={{ color: "var(--text-ghost)", fontFamily: "var(--font-mono)" }}
            >
              {imagePosition}
            </span>
          )}
          {onNext && (
            <button
              type="button"
              onClick={onNext}
              disabled={!canGoNext}
              className="interactive-surface flex h-7 w-7 items-center justify-center rounded-lg disabled:opacity-30"
              style={{ color: "var(--text-tertiary)" }}
              aria-label="Next image"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="interactive-surface flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ color: "var(--text-tertiary)" }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Image — natural aspect ratio with pillar glow */}
      <div
        className="relative overflow-hidden rounded-xl animate-fade-in"
        style={{
          aspectRatio: `${image.width ?? 1} / ${image.height ?? 1}`,
          boxShadow: "var(--shadow-pillar-glow)",
        }}
      >
        <Image
          src={image.thumbSrc}
          alt={image.prompt}
          fill
          sizes="380px"
          className="rounded-xl object-cover"
          priority
          unoptimized
        />
        <Image
          src={image.fullSrc}
          alt={image.prompt}
          fill
          sizes="380px"
          className={`rounded-xl object-cover transition-opacity ${
            fullLoaded ? "opacity-100" : "opacity-0"
          }`}
          style={{ transitionDuration: "500ms" }}
          priority
          onLoad={(e) => {
            if (e.currentTarget.naturalWidth > 0) setFullLoaded(true);
          }}
          onError={() => setFullLoaded(true)}
          unoptimized
        />
      </div>

      {/* Quick metadata strip */}
      <div className="flex flex-wrap items-center gap-2">
        {modelName && (
          <span
            className="px-2 py-0.5 text-[9px] font-mono font-medium uppercase tracking-wider"
            style={{
              backgroundColor: "rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.1)",
              color: "var(--amber-9)",
              border: "1px solid rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.2)",
            }}
          >
            {modelName}
          </span>
        )}
        {pillarLabel && (
          <span
            className="text-[10px] font-mono font-medium uppercase tracking-wider"
            style={{ color: "var(--text-tertiary)" }}
          >
            {pillarLabel}
          </span>
        )}
        {relativeDate && (
          <span
            className="text-[10px] font-mono tracking-wide"
            style={{ color: "var(--text-ghost)" }}
          >
            {relativeDate}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div
        ref={tabListRef}
        className="grid grid-cols-3 gap-0 border"
        role="tablist"
        aria-label="Selected image detail tabs"
        style={{ borderColor: "var(--border-default)" }}
        onKeyDown={handleTabKeyDown}
      >
        {TABS.map((tab, idx) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            className="px-2 py-2 font-mono text-[10px] font-medium uppercase tracking-wider transition-all"
            style={{
              color: activeTab === tab.id ? "var(--text-inverse)" : "var(--text-tertiary)",
              backgroundColor: activeTab === tab.id ? "var(--bg-inverse)" : "transparent",
              borderRight: idx < TABS.length - 1 ? "1px solid var(--border-default)" : "none",
              transitionDuration: "var(--duration-instant)",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === "prompt" && (
          <div key="tab-prompt" className="animate-tab-content-enter flex flex-col gap-2">
            <span
              className="text-[11px] font-medium uppercase tracking-wider"
              style={{ color: "var(--text-tertiary)" }}
            >
              Prompt
            </span>
            <div
              style={{
                borderLeft: "2px solid rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.3)",
                paddingLeft: "12px",
              }}
            >
              <p
                className="text-[14px]"
                style={{
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-display)",
                  fontStyle: "italic",
                  lineHeight: "1.7",
                  ...(!promptExpanded && isLongPrompt
                    ? {
                        display: "-webkit-box",
                        WebkitLineClamp: 5,
                        WebkitBoxOrient: "vertical" as const,
                        overflow: "hidden",
                      }
                    : {}),
                }}
              >
                {image.prompt}
              </p>
            </div>
            <div ref={copyMenuRef} className="relative flex items-center gap-3">
              <button
                type="button"
                onClick={() => setCopyMenuOpen(!copyMenuOpen)}
                className="flex items-center gap-1.5 text-[13px] transition-colors duration-[var(--duration-instant)] hover:text-[var(--text-primary)]"
                aria-label="Copy options"
                style={{ color: "var(--text-tertiary)" }}
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" style={{ color: "var(--amber-9)" }} />
                    <span style={{ color: "var(--amber-9)" }}>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                    <ChevronDown className="h-3 w-3" />
                  </>
                )}
              </button>
              {copyMenuOpen && !copied && (
                <div
                  className="absolute left-0 top-full z-10 mt-1 flex flex-col rounded-lg border py-1 animate-dropdown-enter"
                  style={{
                    backgroundColor: "var(--paper)",
                    borderColor: "var(--border-default)",
                    boxShadow: "var(--shadow-md)",
                    minWidth: "200px",
                  }}
                >
                  <CopyMenuItem icon={Copy} label="Copy Prompt" hint="⌘C" primary onClick={() => void handleCopy()} />
                  <div className="mx-2 my-0.5 h-px" style={{ backgroundColor: "var(--border-subtle)" }} />
                  <CopyMenuItem icon={LinkIcon} label="Copy Image URL" onClick={() => void handleCopyUrl()} />
                  <CopyMenuItem icon={Package} label="Copy Full Package" onClick={() => void handleCopyPackage()} />
                </div>
              )}
              <button
                type="button"
                onClick={() => void handleDownload()}
                className="flex items-center gap-1.5 text-[13px] transition-colors duration-[var(--duration-instant)] hover:text-[var(--text-primary)]"
                aria-label="Download image"
                style={{ color: "var(--text-tertiary)" }}
              >
                {downloadStarted ? (
                  <>
                    <Check className="h-3.5 w-3.5" style={{ color: "var(--amber-9)" }} />
                    <span style={{ color: "var(--amber-9)" }}>Started!</span>
                  </>
                ) : (
                  <>
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </>
                )}
              </button>
            </div>
            {isLongPrompt && (
              <button
                type="button"
                onClick={() => setPromptExpanded(!promptExpanded)}
                className="flex items-center gap-1 self-start text-[12px] transition-colors duration-[var(--duration-instant)] hover:text-[var(--amber-9)]"
                style={{ color: "var(--text-tertiary)" }}
              >
                {promptExpanded ? (
                  <>
                    <ChevronUp className="h-3 w-3" /> Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3" /> Show more
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {activeTab === "details" && (
          <div key="tab-details" className="animate-tab-content-enter flex flex-col gap-3">
            {modelName && (
              <DetailRow
                label="Model"
                value={
                  <span
                    className="px-2 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wider"
                    style={{
                      backgroundColor:
                        "rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.1)",
                      color: "var(--amber-9)",
                      border: "1px solid rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.2)",
                    }}
                  >
                    {modelName}
                  </span>
                }
              />
            )}
            {pillarLabel && <DetailRow label="Pillar" value={pillarLabel} />}
            {createdAtLabel && <DetailRow label="Created" value={createdAtLabel} />}
            {image.sourceUrl && (
              <DetailRow
                label="Source"
                value={
                  <a
                    href={image.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-dotted underline-offset-2"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    Open source
                  </a>
                }
              />
            )}
            {canManageFolder && (
              <div className="flex flex-col gap-1.5">
                <span
                  className="text-[11px] font-medium uppercase tracking-wider"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  Folder
                </span>
                <select
                  aria-label="Select folder"
                  value={image.folderId ?? NO_FOLDER_VALUE}
                  onChange={(event) => handleFolderChange(event.target.value)}
                  disabled={folderBusy}
                  className="h-9 w-full border px-2.5 font-mono text-[11px] uppercase tracking-wider disabled:opacity-60"
                  style={{
                    borderColor: "var(--border-default)",
                    backgroundColor: "var(--surface-1)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <option value={NO_FOLDER_VALUE}>No folder</option>
                  {folders.map((folder) => (
                    <option key={folder._id} value={folder._id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
                {onCreateFolder && (
                  <div className="flex items-center gap-2">
                    <input
                      value={folderDraftName}
                      onChange={(event) => setFolderDraftName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        void handleCreateFolder();
                      }}
                      placeholder="Create folder"
                      className="h-9 flex-1 border px-2.5 text-[12px]"
                      style={{
                        borderColor: "var(--border-default)",
                        backgroundColor: "var(--surface-1)",
                        color: "var(--text-secondary)",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void handleCreateFolder()}
                      disabled={creatingFolder || folderDraftName.trim().length === 0}
                      className="h-9 border px-2.5 font-mono text-[10px] uppercase tracking-wider disabled:opacity-60"
                      style={{
                        borderColor: "var(--border-default)",
                        backgroundColor: "var(--surface-2)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {creatingFolder ? "Saving..." : "Create"}
                    </button>
                  </div>
                )}
                {folderError && (
                  <p className="text-[11px]" style={{ color: "#e5534b" }} role="alert">
                    {folderError}
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <span
                className="text-[11px] font-medium uppercase tracking-wider"
                style={{ color: "var(--text-tertiary)" }}
              >
                Tags
              </span>
              <div className="flex flex-wrap gap-1.5">
                {tagNames && tagNames.length > 0 ? (
                  tagNames.map((tag) => (
                    <span
                      key={tag}
                      className="border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider"
                      style={{
                        backgroundColor: "transparent",
                        color: "var(--text-secondary)",
                        borderColor: "var(--border-default)",
                      }}
                    >
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--text-ghost)" }}>
                    No tags
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "actions" && (
          <div key="tab-actions" className="animate-tab-content-enter flex flex-col gap-2">
            {activeRunId && (
              <button
                type="button"
                onClick={onOpenRun}
                className="flex items-center justify-between rounded-xl px-3 py-2 text-[12px] transition-colors"
                aria-label="View active run"
                style={{
                  border: "1px solid rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.25)",
                  backgroundColor:
                    "rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.08)",
                  color: "var(--text-secondary)",
                }}
              >
                <span>Run active: {activeRunId}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
            {ACTIONS.map(({ intent, label, icon: Icon }) => (
              <button
                key={intent}
                type="button"
                onClick={() => onAction(intent, image.id)}
                className="flex items-center gap-2.5 border border-[var(--border-default)] px-3 py-2.5 transition-[background-color,border-color,box-shadow,transform] duration-[var(--duration-fast)] hover:bg-[var(--bg-inverse)] hover:text-[var(--text-inverse)] hover:border-[var(--bg-inverse)] hover:shadow-[var(--shadow-brutal-sm)] hover:-translate-x-px hover:-translate-y-px active:translate-x-0 active:translate-y-0 active:shadow-none"
                aria-label={label}
              >
                <Icon
                  className="h-4 w-4"
                  style={{ color: "currentColor", opacity: 0.6 }}
                />
                <span
                  className="flex-1 text-left text-[10px] font-mono font-medium uppercase tracking-wider"
                >
                  {label}
                </span>
                <ArrowRight
                  className="h-3.5 w-3.5"
                  style={{ opacity: 0.4 }}
                />
              </button>
            ))}
            {canCuratePublic && onSetPublicState && (
              <>
                <div className="my-1 h-px" style={{ backgroundColor: "var(--border-subtle)" }} />
                <button
                  type="button"
                  onClick={() => onSetPublicState(image.id, !Boolean(image.isPublic))}
                  disabled={curationBusy}
                  className="flex items-center gap-2.5 border px-3 py-2.5 transition-[background-color,border-color,opacity] duration-[var(--duration-fast)] disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    borderColor: "rgba(46, 184, 180, 0.45)",
                    color: "var(--text-secondary)",
                    backgroundColor: "rgba(46, 184, 180, 0.08)",
                  }}
                >
                  <span className="flex-1 text-left text-[10px] font-mono font-medium uppercase tracking-wider">
                    {curationBusy
                      ? "Saving..."
                      : image.isPublic
                        ? "Remove from Public"
                        : "Publish to Public"}
                  </span>
                </button>
                {onSetFeaturedState && (
                  <button
                    type="button"
                    onClick={() => onSetFeaturedState(image.id, !Boolean(image.isFeatured))}
                    disabled={curationBusy || !image.isPublic}
                    className="flex items-center gap-2.5 border px-3 py-2.5 transition-[background-color,border-color,opacity] duration-[var(--duration-fast)] disabled:cursor-not-allowed disabled:opacity-60"
                    style={{
                      borderColor: "rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.45)",
                      color: "var(--text-secondary)",
                      backgroundColor:
                        image.isFeatured && image.isPublic
                          ? "rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.15)"
                          : "rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.08)",
                    }}
                  >
                    <span className="flex-1 text-left text-[10px] font-mono font-medium uppercase tracking-wider">
                      {curationBusy
                        ? "Saving..."
                        : image.isFeatured
                          ? "Unset Featured"
                          : "Set as Featured"}
                    </span>
                  </button>
                )}
                {curationError && (
                  <p className="text-[11px]" style={{ color: "#e5534b" }} role="alert">
                    {curationError}
                  </p>
                )}
              </>
            )}
            {onDelete && (
              <>
                <div className="my-1 h-px" style={{ backgroundColor: "var(--border-subtle)" }} />
                <button
                  type="button"
                  onClick={() => onDelete(image.id)}
                  disabled={deleting}
                  className="flex items-center gap-2.5 border px-3 py-2.5 transition-[background-color,border-color,opacity] duration-[var(--duration-fast)] disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="Delete asset"
                  style={{
                    borderColor: "rgba(229, 83, 75, 0.45)",
                    color: "#e5534b",
                    backgroundColor: "rgba(229, 83, 75, 0.08)",
                  }}
                >
                  <Trash2 className="h-4 w-4" style={{ opacity: 0.9 }} />
                  <span className="flex-1 text-left text-[10px] font-mono font-medium uppercase tracking-wider">
                    {deleting ? "Deleting..." : "Delete Asset"}
                  </span>
                </button>
                {deleteError && (
                  <p className="text-[11px]" style={{ color: "#e5534b" }} role="alert">
                    {deleteError}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Copy toast */}
      {toastVisible && (
        <div
          className={`pointer-events-none absolute inset-x-4 bottom-4 z-10 flex items-center justify-center ${toastExiting ? "animate-toast-exit" : "animate-toast-enter"}`}
        >
          <div
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-medium"
            style={{
              backgroundColor: "rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.12)",
              border: "1px solid rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.25)",
              color: "var(--text-primary)",
              boxShadow: "var(--shadow-md)",
            }}
          >
            <Check className="h-3.5 w-3.5" style={{ color: "var(--amber-9)" }} />
            {copiedLabel}
          </div>
        </div>
      )}
    </div>
  );
}

function CopyMenuItem({
  icon: Icon,
  label,
  hint,
  primary,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  hint?: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="interactive-ghost flex items-center gap-2 px-3 py-1.5 text-left text-[12px]"
      style={{
        color: "var(--text-secondary)",
        fontWeight: primary ? 600 : 400,
      }}
    >
      <Icon className="h-3.5 w-3.5" style={{ color: "var(--text-ghost)" }} />
      <span className="flex-1">{label}</span>
      {hint && (
        <span className="text-[10px]" style={{ color: "var(--text-ghost)" }}>
          {hint}
        </span>
      )}
    </button>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span
        className="mt-0.5 min-w-[72px] text-[11px] font-medium uppercase tracking-wider"
        style={{ color: "var(--text-tertiary)" }}
      >
        {label}
      </span>
      <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
        {value}
      </span>
    </div>
  );
}
