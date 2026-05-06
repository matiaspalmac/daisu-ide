import { type JSX, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { X } from "@phosphor-icons/react";
import { useBottomPanel, type BottomTab } from "../../stores/bottomPanelStore";
import { useDiagnostics, startDiagnosticsListener } from "../../stores/diagnosticsStore";
import type { LspDiagnostic } from "../../lib/lsp";
import { ProblemsView } from "./ProblemsView";
import { OutputView } from "./OutputView";
import { PlaceholderView } from "./PlaceholderView";
import { TerminalSlot } from "./TerminalSlot";

const TAB_ORDER: BottomTab[] = ["problems", "output", "debug", "terminal", "ports"];

function computeTotals(
  byKey: Record<string, LspDiagnostic[]>,
): { errors: number; warnings: number; infos: number; hints: number } {
  const totals = { errors: 0, warnings: 0, infos: 0, hints: 0 };
  for (const v of Object.values(byKey)) {
    for (const d of v) {
      switch (d.severity ?? 1) {
        case 1: totals.errors += 1; break;
        case 2: totals.warnings += 1; break;
        case 3: totals.infos += 1; break;
        case 4: totals.hints += 1; break;
      }
    }
  }
  return totals;
}

export function BottomPanel(): JSX.Element | null {
  const { t } = useTranslation();
  // Individual selectors — destructuring the full store returns a fresh
  // object reference on every render and trips React 18's
  // useSyncExternalStore "getSnapshot should be cached" guard.
  const open = useBottomPanel((s) => s.open);
  const active = useBottomPanel((s) => s.active);
  const setActive = useBottomPanel((s) => s.setActive);
  const setOpen = useBottomPanel((s) => s.setOpen);
  // Subscribe to the raw map and derive totals locally; calling the
  // store's totals() inside a selector returns a new object literal each
  // render, which is the same infinite-loop trap as a destructure.
  const byKey = useDiagnostics((s) => s.byKey);
  const totals = useMemo(() => computeTotals(byKey), [byKey]);

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
