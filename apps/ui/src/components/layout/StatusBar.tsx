import type { JSX } from "react";
import { PanelLeft, PanelRight, Settings } from "lucide-react";
import { useWorkspace } from "../../stores/workspaceStore";
import { useUI } from "../../stores/uiStore";
import { useSettings } from "../../stores/settingsStore";
import { BranchSegment } from "../statusbar/BranchSegment";
import { SearchProgress } from "../statusbar/SearchProgress";
import { CursorSegment } from "../statusbar/CursorSegment";
import { EolSegment } from "../statusbar/EolSegment";
import { EncodingSegment } from "../statusbar/EncodingSegment";
import { IndentSegment } from "../statusbar/IndentSegment";
import { LanguagePicker } from "../statusbar/LanguagePicker";

const utilityCls =
  "h-5 px-1.5 inline-flex items-center gap-1 text-[var(--fg-muted)] hover:text-[var(--warn)] hover:bg-[var(--warn-soft)] rounded-[var(--radius-sm)] transition-colors text-[11px]";

const panelToggleCls =
  "h-5 px-1.5 inline-flex items-center gap-1 text-[var(--warn)] hover:text-[var(--warn-bright)] hover:bg-[var(--warn-soft)] rounded-[var(--radius-sm)] transition-colors";

export function StatusBar(): JSX.Element {
  const openSettings = useUI((s) => s.openSettings);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const toggleAgents = useUI((s) => s.toggleAgentsPanel);
  const design = useSettings((s) => s.settings.design);

  return (
    <footer
      className="daisu-statusbar h-[24px] flex items-center px-3 gap-3 bg-[var(--bg-panel)] border-t border-[var(--border-subtle)] text-[11px] text-[var(--fg-secondary)]"
      aria-label="Status bar"
    >
      {/* Left: file info segments */}
      <div className="flex items-center gap-3 flex-shrink min-w-0">
        <CursorSegment />
        <LanguagePicker />
        <EncodingSegment />
        <EolSegment />
        <IndentSegment />
      </div>

      {/* Center: branch + search progress */}
      <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
        <BranchSegment />
        <SearchProgress />
      </div>

      {/* Right: utility cluster */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {design.statusBarUtility && (
        <>
        <button
          type="button"
          className={utilityCls}
          title="Configuración (Ctrl+,)"
          aria-label="Configuración"
          onClick={() => openSettings()}
        >
          <Settings size={12} />
        </button>
        <span className="h-3 w-px bg-[var(--border-subtle)] mx-1" aria-hidden="true" />
        </>
        )}
        {design.statusBarPanelToggles && (
        <>
        <button
          type="button"
          className={panelToggleCls}
          title="Panel lateral (Ctrl+B)"
          aria-label="Panel lateral"
          onClick={() => toggleSidebar()}
        >
          <PanelLeft size={12} />
        </button>
        <button
          type="button"
          className={panelToggleCls}
          title="Panel de chat (Ctrl+Shift+B)"
          aria-label="Panel de chat"
          onClick={() => toggleAgents()}
        >
          <PanelRight size={12} />
        </button>
        </>
        )}
      </div>
      {/* Workspace name retained from rootPath for screen readers but not visually rendered. */}
      <span className="sr-only">{useWorkspace.getState().rootPath ?? ""}</span>
    </footer>
  );
}
