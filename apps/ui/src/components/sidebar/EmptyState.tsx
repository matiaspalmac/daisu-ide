import type { JSX } from "react";
import { copy } from "../../lib/copy";

type Variant = "no-folder" | "walking" | "empty-folder" | "read-error";

interface Props {
  variant: Variant;
  message?: string | undefined;
  onOpenFolder?: (() => void) | undefined;
  onNewFile?: (() => void) | undefined;
  onNewFolder?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onOpenDifferent?: (() => void) | undefined;
}

export function EmptyState(props: Props): JSX.Element {
  switch (props.variant) {
    case "no-folder":
      return (
        <div className="daisu-empty-state" role="status">
          <span className="daisu-glyph daisu-glyph-xl" aria-hidden="true">空</span>
          <h3 className="text-sm text-[var(--fg-secondary)]">{copy.sidebar.noFolderTitle}</h3>
          <p className="text-xs text-[var(--fg-muted)]">{copy.sidebar.noFolderBody}</p>
          <button
            type="button"
            onClick={props.onOpenFolder}
            className="inline-flex items-center justify-center h-8 px-4 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--fg-inverse)] hover:bg-[var(--accent-bright)] shadow-[var(--glow-cyan-md)] text-sm font-medium transition-colors cursor-pointer"
          >
            {copy.buttons.openFolder}
          </button>
        </div>
      );
    case "walking":
      return (
        <div className="daisu-empty-state" role="status" aria-live="polite">
          <span className="daisu-spinner" aria-hidden="true" />
          <p>{copy.sidebar.walkingLabel}</p>
        </div>
      );
    case "empty-folder":
      return (
        <div className="daisu-empty-state" role="status">
          <span className="daisu-glyph daisu-glyph-xl" aria-hidden="true">無</span>
          <p>{copy.sidebar.emptyFolderTitle}</p>
          <div className="daisu-empty-actions">
            <button type="button" className="daisu-btn" onClick={props.onNewFile}>
              {copy.buttons.newFile}
            </button>
            <button type="button" className="daisu-btn" onClick={props.onNewFolder}>
              {copy.buttons.newFolder}
            </button>
          </div>
        </div>
      );
    case "read-error":
      return (
        <div className="daisu-empty-state" role="alert">
          <h3>{copy.sidebar.readErrorTitle}</h3>
          {props.message && <p>{props.message}</p>}
          <div className="daisu-empty-actions">
            <button type="button" className="daisu-btn" onClick={props.onRetry}>
              {copy.buttons.retry}
            </button>
            <button type="button" className="daisu-btn" onClick={props.onOpenDifferent}>
              {copy.buttons.openDifferent}
            </button>
          </div>
        </div>
      );
  }
}
