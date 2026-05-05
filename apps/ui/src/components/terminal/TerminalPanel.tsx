import { type JSX } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "@phosphor-icons/react";
import { useWorkspace } from "../../stores/workspaceStore";
import { useTerminal } from "../../stores/terminalStore";
import { TerminalView } from "./TerminalView";

export function TerminalPanel(): JSX.Element | null {
  const { t } = useTranslation();
  const { open, tabs, activeId, newTab, closeTab, setActive, setOpen } = useTerminal();
  const cwd = useWorkspace((s) => s.rootPath ?? ".");

  if (!open) return null;

  return (
    <div className="flex flex-col h-full bg-[var(--bg-panel)] border-t border-[var(--border-subtle)]">
      <div className="flex items-center gap-1 px-2 h-7 border-b border-[var(--border-subtle)] text-[11px]">
        {tabs.map((tab) => (
          <button
            key={tab.uiId}
            type="button"
            className={
              "h-5 px-2 inline-flex items-center gap-1 rounded-[var(--radius-sm)] " +
              (tab.uiId === activeId
                ? "bg-[var(--bg-elevated)] text-[var(--fg-primary)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]")
            }
            onClick={() => setActive(tab.uiId)}
          >
            <span>{tab.title}</span>
            <X
              size={11}
              className="opacity-60 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.uiId);
              }}
            />
          </button>
        ))}
        <button
          type="button"
          className="h-5 px-1.5 inline-flex items-center gap-1 text-[var(--fg-muted)] hover:text-[var(--fg-secondary)] rounded-[var(--radius-sm)]"
          onClick={() => newTab()}
          title={t("terminal.newTab")}
          aria-label={t("terminal.newTab")}
        >
          <Plus size={11} />
        </button>
        <span className="ml-auto" />
        <button
          type="button"
          className="h-5 px-1.5 inline-flex items-center text-[var(--fg-muted)] hover:text-[var(--fg-secondary)] rounded-[var(--radius-sm)]"
          onClick={() => setOpen(false)}
          title={t("terminal.close")}
          aria-label={t("terminal.close")}
        >
          <X size={11} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
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
    </div>
  );
}
