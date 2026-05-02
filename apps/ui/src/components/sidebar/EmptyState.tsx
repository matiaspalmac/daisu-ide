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
          <h3>{copy.sidebar.noFolderTitle}</h3>
          <p>{copy.sidebar.noFolderBody}</p>
          <button type="button" className="daisu-btn-primary" onClick={props.onOpenFolder}>
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
