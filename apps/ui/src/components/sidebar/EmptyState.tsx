import type { JSX } from "react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  switch (props.variant) {
    case "no-folder":
      return (
        <div className="daisu-empty-state" role="status">
          <span className="daisu-glyph daisu-glyph-xl" aria-hidden="true">空</span>
          <h3 className="text-sm text-[var(--fg-secondary)]">{t("explorer.noFolderTitle")}</h3>
          <p className="text-xs text-[var(--fg-muted)]">{t("explorer.noFolderBody")}</p>
          <button
            type="button"
            onClick={props.onOpenFolder}
            className="inline-flex items-center justify-center h-8 px-4 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--fg-inverse)] hover:bg-[var(--accent-bright)] shadow-[var(--glow-cyan-md)] text-sm font-medium transition-colors cursor-pointer"
          >
            {t("explorer.openFolder")}
          </button>
        </div>
      );
    case "walking":
      return (
        <div className="daisu-empty-state" role="status" aria-live="polite">
          <span className="daisu-spinner" aria-hidden="true" />
          <p>{t("explorer.walkingLabel")}</p>
        </div>
      );
    case "empty-folder":
      return (
        <div className="daisu-empty-state" role="status">
          <span className="daisu-glyph daisu-glyph-xl" aria-hidden="true">無</span>
          <p>{t("explorer.emptyFolderTitle")}</p>
          <div className="daisu-empty-actions">
            <button type="button" className="daisu-btn" onClick={props.onNewFile}>
              {t("explorer.newFile")}
            </button>
            <button type="button" className="daisu-btn" onClick={props.onNewFolder}>
              {t("explorer.newFolder")}
            </button>
          </div>
        </div>
      );
    case "read-error":
      return (
        <div className="daisu-empty-state" role="alert">
          <h3>{t("explorer.readErrorTitle")}</h3>
          {props.message && <p>{props.message}</p>}
          <div className="daisu-empty-actions">
            <button type="button" className="daisu-btn" onClick={props.onRetry}>
              {t("explorer.retry")}
            </button>
            <button type="button" className="daisu-btn" onClick={props.onOpenDifferent}>
              {t("explorer.openDifferent")}
            </button>
          </div>
        </div>
      );
  }
}
