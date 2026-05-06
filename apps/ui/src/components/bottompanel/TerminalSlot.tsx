import { type JSX } from "react";
import { useTranslation } from "react-i18next";
import { X } from "@phosphor-icons/react";
import { useWorkspace } from "../../stores/workspaceStore";
import { useTerminal } from "../../stores/terminalStore";
import { useSettings } from "../../stores/settingsStore";
import { TerminalView } from "../terminal/TerminalView";
import { ShellPicker } from "../terminal/ShellPicker";

export function TerminalSlot(): JSX.Element {
  const { t } = useTranslation();
  // Individual selectors — destructuring the whole store returns a fresh
  // object reference on every render, which trips React 18's
  // useSyncExternalStore "getSnapshot should be cached" guard and triggers
  // an infinite render loop the moment BottomPanel mounts.
  const tabs = useTerminal((s) => s.tabs);
  const activeId = useTerminal((s) => s.activeId);
  const newTab = useTerminal((s) => s.newTab);
  const closeTab = useTerminal((s) => s.closeTab);
  const setActive = useTerminal((s) => s.setActive);
  const cwd = useWorkspace((s) => s.rootPath ?? "");
  const defaultShellId = useSettings(
    (s) => s.settings.editor.terminalDefaultShellId,
  );

  const handlePick = (shell: { id: string } | null): void => {
    newTab(shell?.id ?? defaultShellId ?? undefined);
  };

  if (tabs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[11px] text-[var(--fg-muted)]">
        <ShellPicker onPick={handlePick} />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Vertical session strip on the right (VSCode-ish). */}
      <div className="flex-1 min-w-0">
        {tabs.map((tab) => (
          <div
            key={tab.uiId}
            style={{ display: tab.uiId === activeId ? "block" : "none" }}
            className="h-full w-full"
          >
            <TerminalView
              cwd={cwd}
              shellId={tab.shellId}
              onExit={() => closeTab(tab.uiId)}
            />
          </div>
        ))}
      </div>
      <div className="w-[140px] flex-shrink-0 border-l border-[var(--border-subtle)] flex flex-col text-[11px] overflow-y-auto">
        <ShellPicker onPick={handlePick} />
        {tabs.map((tab) => (
          <div
            key={tab.uiId}
            className={
              "h-6 px-2 flex items-center justify-between gap-1 cursor-pointer " +
              (tab.uiId === activeId
                ? "bg-[var(--bg-elevated)] text-[var(--fg-primary)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]")
            }
            onClick={() => setActive(tab.uiId)}
          >
            <span className="truncate">{tab.title}</span>
            <button
              type="button"
              className="opacity-60 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.uiId);
              }}
              aria-label={t("terminal.killTab")}
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
