import type { JSX } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, Sidebar, SidebarSimple, Gear, Warning, XCircle } from "@phosphor-icons/react";
import { useWorkspace } from "../../stores/workspaceStore";
import { useUI } from "../../stores/uiStore";
import { useSettings } from "../../stores/settingsStore";
import { useGit } from "../../stores/gitStore";
import { SearchProgress } from "../statusbar/SearchProgress";
import { CursorSegment } from "../statusbar/CursorSegment";
import { EolSegment } from "../statusbar/EolSegment";
import { EncodingSegment } from "../statusbar/EncodingSegment";
import { IndentSegment } from "../statusbar/IndentSegment";
import { LanguagePicker } from "../statusbar/LanguagePicker";
import { McpStatusChip } from "../agent/McpStatusChip";
import { LspTrustChip } from "../statusbar/LspTrustChip";
import { LspServerStatusChip } from "../statusbar/LspServerStatusChip";

const utilityCls =
  "h-5 px-1.5 inline-flex items-center gap-1 text-[var(--fg-muted)] hover:text-[var(--warn)] hover:bg-[var(--warn-soft)] rounded-[var(--radius-sm)] transition-colors text-[11px]";

const panelToggleCls =
  "h-5 px-1.5 inline-flex items-center gap-1 text-[var(--warn)] hover:text-[var(--warn-bright)] hover:bg-[var(--warn-soft)] rounded-[var(--radius-sm)] transition-colors";

export function StatusBar(): JSX.Element {
  const { t } = useTranslation();
  const openSettings = useUI((s) => s.openSettings);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const toggleAgents = useUI((s) => s.toggleAgentsPanel);
  const pushToast = useUI((s) => s.pushToast);
  const design = useSettings((s) => s.settings.design);
  const isFleet = design.layoutMode === "fleet";
  const rootPath = useWorkspace((s) => s.rootPath);
  const gitInfo = useGit((s) => s.info);
  const projectName = useMemo(() => {
    if (!rootPath) return null;
    const parts = rootPath.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? rootPath;
  }, [rootPath]);

  return (
    <footer
      className={
        "daisu-statusbar h-[24px] flex items-center px-3 gap-3 bg-[var(--bg-panel)] border-t border-[var(--border-subtle)] text-[11px] text-[var(--fg-secondary)]" +
        (isFleet ? " daisu-statusbar--slim" : "")
      }
      aria-label={t("statusBar.aria")}
    >
      {/* Left: file info segments */}
      <div className="flex items-center gap-3 flex-shrink min-w-0">
        <CursorSegment />
        <LanguagePicker />
        <EncodingSegment />
        <EolSegment />
        <IndentSegment />
      </div>

      {/* Center: workspace pill + search progress */}
      <div className="flex-1 flex items-center justify-center gap-3 min-w-0">
        {projectName && (
          <div className="daisu-workspace-pill daisu-workspace-pill-sm">
            <span className="daisu-glyph" aria-hidden="true">場</span>
            <span className="daisu-workspace-name">{projectName}</span>
            {gitInfo?.branch && (
              <>
                <span className="daisu-workspace-sep" aria-hidden="true">·</span>
                <span className="daisu-workspace-branch">
                  <GitBranch size={10} />
                  {gitInfo.branch}
                  {gitInfo.ahead > 0 && (
                    <span className="daisu-workspace-ahead" title={t("status.aheadCommits", { count: gitInfo.ahead })}>
                      ↑{gitInfo.ahead}
                    </span>
                  )}
                  {gitInfo.behind > 0 && (
                    <span className="daisu-workspace-behind" title={t("status.behindCommits", { count: gitInfo.behind })}>
                      ↓{gitInfo.behind}
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
        )}
        <SearchProgress />
      </div>

      {/* Right: utility cluster */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {(isFleet || design.statusBarUtility) && (
          <button
            type="button"
            className={utilityCls}
            title={t("status.problemsTooltip")}
            aria-label={t("status.problems")}
            onClick={() =>
              pushToast({ message: t("status.problemsComingSoon"), level: "info" })
            }
          >
            <XCircle size={11} />
            <span>0</span>
            <Warning size={11} />
            <span>0</span>
          </button>
        )}
        <LspTrustChip />
        <LspServerStatusChip />
        <McpStatusChip />
        {!isFleet && design.statusBarUtility && (
        <>
        <button
          type="button"
          className={utilityCls}
          title={t("status.settingsTooltip")}
          aria-label={t("status.settings")}
          onClick={() => openSettings()}
        >
          <Gear size={12} />
        </button>
        <span className="h-3 w-px bg-[var(--border-subtle)] mx-1" aria-hidden="true" />
        </>
        )}
        {!isFleet && design.statusBarPanelToggles && (
        <>
        <button
          type="button"
          className={panelToggleCls}
          title={t("status.sidebarTooltip")}
          aria-label={t("status.sidebar")}
          onClick={() => toggleSidebar()}
        >
          <Sidebar size={12} />
        </button>
        <button
          type="button"
          className={panelToggleCls}
          title={t("status.chatPanelTooltip")}
          aria-label={t("status.chatPanel")}
          onClick={() => toggleAgents()}
        >
          <SidebarSimple size={12} />
        </button>
        </>
        )}
      </div>
    </footer>
  );
}
