import { type JSX, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X } from "@phosphor-icons/react";
import { useBottomPanel, type BottomTab } from "../../stores/bottomPanelStore";
import { useDiagnostics, startDiagnosticsListener } from "../../stores/diagnosticsStore";
import { ProblemsView } from "./ProblemsView";
import { OutputView } from "./OutputView";
import { PlaceholderView } from "./PlaceholderView";
import { TerminalSlot } from "./TerminalSlot";

const TAB_ORDER: BottomTab[] = ["problems", "output", "debug", "terminal", "ports"];

export function BottomPanel(): JSX.Element | null {
  const { t } = useTranslation();
  const { open, active, setActive, setOpen } = useBottomPanel();
  const totals = useDiagnostics((s) => s.totals());

  useEffect(() => {
    startDiagnosticsListener();
  }, []);

  if (!open) return null;

  const labels: Record<BottomTab, string> = {
    problems: t("bottomPanel.problems"),
    output: t("bottomPanel.output"),
    debug: t("bottomPanel.debug"),
    terminal: t("bottomPanel.terminal"),
    ports: t("bottomPanel.ports"),
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-panel)] border-t border-[var(--border-subtle)]">
      <div className="flex items-center gap-2 px-2 h-7 border-b border-[var(--border-subtle)] text-[11px]">
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            type="button"
            className={
              "h-5 px-2 inline-flex items-center gap-1 rounded-[var(--radius-sm)] uppercase tracking-wide " +
              (tab === active
                ? "text-[var(--fg-primary)] border-b-2 border-[var(--warn)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]")
            }
            onClick={() => setActive(tab)}
          >
            <span>{labels[tab]}</span>
            {tab === "problems" && (totals.errors > 0 || totals.warnings > 0) && (
              <span className="ml-1 text-[var(--fg-muted)]">
                {totals.errors > 0 ? `${totals.errors}` : ""}
                {totals.errors > 0 && totals.warnings > 0 ? " · " : ""}
                {totals.warnings > 0 ? `${totals.warnings}` : ""}
              </span>
            )}
          </button>
        ))}
        <span className="ml-auto" />
        <button
          type="button"
          className="h-5 px-1.5 inline-flex items-center text-[var(--fg-muted)] hover:text-[var(--fg-secondary)] rounded-[var(--radius-sm)]"
          onClick={() => setOpen(false)}
          title={t("bottomPanel.close")}
          aria-label={t("bottomPanel.close")}
        >
          <X size={11} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {active === "problems" && <ProblemsView />}
        {active === "output" && <OutputView />}
        {active === "debug" && <PlaceholderView message={t("bottomPanel.debugComingSoon")} />}
        {active === "terminal" && <TerminalSlot />}
        {active === "ports" && <PlaceholderView message={t("bottomPanel.portsComingSoon")} />}
      </div>
    </div>
  );
}
