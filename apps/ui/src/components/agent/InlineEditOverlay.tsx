// TODO(M3 Phase 3.1): replace this Radix Dialog scaffold with proper Monaco
// integration. Phase 3.1 must:
//   1. Render hunks as per-line decorations on the active editor model via
//      `monacoEditor.deltaDecorations` (red/green gutter + line background).
//   2. Use Monaco view-zones to inject the inline Accept / Reject controls
//      next to each hunk instead of a centered modal.
//   3. Keep the dialog as a fallback when no editor is mounted (e.g. the
//      target file is not currently open).
// Until then, the dialog gives reviewers a usable hunk-by-hunk approval UI
// without depending on Phase 1 chat panel work.

import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useInlineEdits } from "../../stores/inlineEditStore";

export function InlineEditOverlay(): JSX.Element | null {
  const { t } = useTranslation();
  const activeId = useInlineEdits((s) => s.activeProposalId);
  const proposals = useInlineEdits((s) => s.proposals);
  const accepted = useInlineEdits((s) => s.acceptedHunks);
  const toggleHunk = useInlineEdits((s) => s.toggleHunk);
  const selectAll = useInlineEdits((s) => s.selectAll);
  const selectNone = useInlineEdits((s) => s.selectNone);
  const accept = useInlineEdits((s) => s.accept);
  const reject = useInlineEdits((s) => s.reject);
  const close = useInlineEdits((s) => s.close);

  if (!activeId) return null;
  const proposal = proposals[activeId];
  if (!proposal) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="!max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("inlineEdit.title")}</DialogTitle>
          <DialogDescription>
            {proposal.path} — {proposal.hunks.length} hunk
            {proposal.hunks.length === 1 ? "" : "s"}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-auto p-4 font-mono text-xs leading-5">
          {proposal.hunks.length === 0 && (
            <p className="text-[var(--fg-muted)]">{t("inlineEdit.noDiffs")}</p>
          )}
          {proposal.hunks.map((h, idx) => {
            const isAccepted = accepted.has(idx);
            return (
              <section
                key={`${h.startOld}-${h.startNew}-${idx}`}
                className="mb-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)]"
              >
                <header className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[var(--fg-secondary)]">
                  <input
                    type="checkbox"
                    checked={isAccepted}
                    onChange={() => toggleHunk(idx)}
                    aria-label={t("inlineEdit.hunkAria", { idx: idx + 1 })}
                  />
                  <span>
                    {t("inlineEdit.hunkLabel", {
                      idx: idx + 1,
                      oldStart: h.startOld + 1,
                      oldEnd: h.endOld,
                      newStart: h.startNew + 1,
                      newEnd: h.endNew,
                    })}
                  </span>
                </header>
                <div>
                  {h.oldLines.map((line, i) => (
                    <div
                      key={`o-${i}`}
                      className="px-2 py-px"
                      style={{
                        background: "rgba(248,113,113,0.08)",
                        color: "#fca5a5",
                      }}
                    >
                      <span aria-hidden="true">- </span>
                      {line || " "}
                    </div>
                  ))}
                  {h.newLines.map((line, i) => (
                    <div
                      key={`n-${i}`}
                      className="px-2 py-px"
                      style={{
                        background: "rgba(74,222,128,0.08)",
                        color: "#86efac",
                      }}
                    >
                      <span aria-hidden="true">+ </span>
                      {line || " "}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <DialogFooter>
          <button
            type="button"
            className="px-2 py-1 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
            onClick={selectNone}
          >
            {t("inlineEdit.selectNone")}
          </button>
          <button
            type="button"
            className="px-2 py-1 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
            onClick={selectAll}
          >
            {t("inlineEdit.selectAll")}
          </button>
          <button
            type="button"
            className="px-3 py-1 text-xs text-[var(--fg-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] hover:bg-[var(--accent-soft)]"
            onClick={() => void reject()}
          >
            {t("inlineEdit.rejectAll")}
          </button>
          <button
            type="button"
            className="px-3 py-1 text-xs text-[var(--bg-base)] bg-[var(--accent)] rounded-[var(--radius-sm)] hover:opacity-90"
            onClick={() => void accept()}
            disabled={accepted.size === 0}
          >
            {t("inlineEdit.acceptSelected", { count: accepted.size })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
