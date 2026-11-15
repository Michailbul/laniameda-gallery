"use client";

import { useEffect, useRef, useState } from "react";
import { reviewBase } from "@/lib/review-client";
import { Floating, usePopover } from "./Floating";
import type { BookGroup } from "./StyleBook";
import type { PerPage } from "./stylebook-pdf";

// "PDF" in the style book's top line: the whole book or the style on
// screen, 1 / 4 / 9 frames per page, one click to build and download.
// The builder (pdf-lib and the canvas work) loads only on that click.

type Props = {
  title: string;
  round: string;
  groups: BookGroup[];
  /** The style being read (the index's current key). */
  active: string;
  /** Discarded frames never go into the PDF. */
  archived: (assetId: string) => boolean;
  onToast?: (text: string, error?: boolean) => void;
};

const PER_PAGE: PerPage[] = [1, 4, 9];
const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(bytes > 10 * 1048576 ? 0 : 1)} MB`;

export function BookPdf({ title, round, groups, active, archived, onToast }: Props) {
  const [open, setOpen, anchorRef, popRef] = usePopover();
  const [scope, setScope] = useState<"all" | "one">("all");
  const [perPage, setPerPage] = useState<PerPage>(4);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const activeGroup = groups.find((group) => group.key === active) ?? groups[0];
  const chosen = (scope === "one" && activeGroup ? [activeGroup] : groups)
    .map((group) => ({ ...group, items: group.items.filter((item) => !archived(item.assetId)) }))
    .filter((group) => group.items.length > 0);
  const frames = chosen.reduce((sum, group) => sum + group.items.length, 0);
  const pages = chosen.reduce((sum, group) => sum + Math.max(1, Math.ceil(group.items.length / perPage)), 0);
  const building = progress !== null;

  const build = async () => {
    if (building || frames === 0) return;
    setError(null);
    const controller = new AbortController();
    abort.current = controller;
    setProgress({ done: 0, total: frames });
    try {
      const { buildStyleBookPdf, pdfFileName, saveBlob } = await import("./stylebook-pdf");
      const result = await buildStyleBookPdf({
        project: title,
        round,
        perPage,
        styles: chosen.map((group) => ({
          key: group.key,
          title: group.title,
          line: group.line,
          frames: group.items.map((item) => ({ assetId: item.assetId, code: item.code, thumbs: item.thumbs, width: item.width, height: item.height })),
        })),
        base: reviewBase(),
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      const name = pdfFileName(title, round, scope === "one" ? activeGroup?.title : undefined);
      saveBlob(result.blob, name);
      const note = result.skipped ? ` · ${result.skipped} frames could not be read` : "";
      onToast?.(`Saved ${name} · ${result.pages} pages · ${megabytes(result.blob.size)}${note}`, result.skipped > 0);
      setOpen(false);
    } catch (caught) {
      if (!controller.signal.aborted) {
        const text = caught instanceof Error ? caught.message : "The PDF could not be made.";
        setError(text);
        onToast?.(`The PDF could not be made: ${text}`, true);
      }
    } finally {
      abort.current = null;
      setProgress(null);
    }
  };

  const cancel = () => {
    abort.current?.abort();
    setProgress(null);
  };

  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        className="rv-bk-round rv-bk-pdf"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-busy={building ? "" : undefined}
        onClick={() => setOpen(!open)}
        title="Save the style book as a PDF"
      >
        {building ? `PDF · ${progress.done} / ${progress.total}` : "PDF"}
      </button>
      {open ? (
        <Floating anchorRef={anchorRef} popRef={popRef} placement="bottom-end" label="Style book PDF">
          <div className="rv-pdf">
            <div className="rv-pop-h">Style book PDF</div>
            <div className="rv-pdf-row">
              <span className="k">Styles</span>
              <div className="rv-size" role="group" aria-label="Which styles">
                <button type="button" aria-pressed={scope === "all"} disabled={building} onClick={() => setScope("all")}>
                  All {groups.length}
                </button>
                <button type="button" aria-pressed={scope === "one"} disabled={building || !activeGroup} onClick={() => setScope("one")} title={activeGroup?.title}>
                  <span className="nm">{activeGroup?.title ?? "This style"}</span>
                </button>
              </div>
            </div>
            <div className="rv-pdf-row">
              <span className="k">Per page</span>
              <div className="rv-size" role="group" aria-label="Frames per page">
                {PER_PAGE.map((value) => (
                  <button key={value} type="button" aria-pressed={perPage === value} disabled={building} onClick={() => setPerPage(value)}>
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <p className="rv-pdf-sum">
              {frames} {frames === 1 ? "frame" : "frames"} · {pages} {pages === 1 ? "page" : "pages"} · full bleed, each style from a new page
            </p>
            {building ? (
              <div className="rv-pdf-run" role="status">
                <div className="t">Building PDF · {progress.done} / {progress.total}</div>
                <div className="bar"><span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
                <button type="button" className="rv-btn ghost" onClick={cancel}>Cancel</button>
              </div>
            ) : (
              <>
                {error ? <p className="rv-pdf-err">{error}</p> : null}
                <button type="button" className="rv-btn accent rv-pdf-go" disabled={frames === 0} onClick={() => void build()}>
                  Download PDF
                </button>
              </>
            )}
          </div>
        </Floating>
      ) : null}
    </>
  );
}
