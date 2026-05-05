import { type JSX } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "@phosphor-icons/react";
import { useWorkspace } from "../../stores/workspaceStore";
import { useTerminal } from "../../stores/terminalStore";
import { TerminalView } from "../terminal/TerminalView";

export function TerminalSlot(): JSX.Element {
  const { t } = useTranslation();
  const { tabs, activeId, newTab, closeTab, setActive } = useTerminal();
  const cwd = useWorkspace((s) => s.rootPath ?? ".");

  if (tabs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[11px] text-[var(--fg-muted)]">
        <button
          type="button"
          className="px-2 py-1 rounded-[var(--radius-sm)] hover:bg-[var(--bg-elevated)]"
          onClick={() => newTab()}
        >
          + {t("terminal.newTab")}
        </button>
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
            <TerminalView cwd={cwd} onExit={() => closeTab(tab.uiId)} />
          </div>
        ))}
      </div>
      <div className="w-[140px] flex-shrink-0 border-l border-[var(--border-subtle)] flex flex-col text-[11px] overflow-y-auto">
        <button
          type="button"
          className="h-6 px-2 flex items-center gap-1 text-[var(--fg-muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)]"
          onClick={() => newTab()}
          title={t("terminal.newTab")}
          aria-label={t("terminal.newTab")}
        >
          <Plus size={11} /> {t("terminal.newTab")}
        </button>
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
