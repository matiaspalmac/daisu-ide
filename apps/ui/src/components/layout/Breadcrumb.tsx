import type { JSX } from "react";
import { useMemo } from "react";
import { useTabs } from "../../stores/tabsStore";
import { useWorkspace } from "../../stores/workspaceStore";

/**
 * Daisu breadcrumb — path of the active tab rendered as segments separated
 * by gold dots. Last segment (filename) is highlighted accent. Click any
 * folder segment is a no-op for now (Phase 1: visual orientation only).
 */
export function Breadcrumb(): JSX.Element | null {
  const activeTabId = useTabs((s) => s.activeTabId);
  const tabs = useTabs((s) => s.tabs);
  const rootPath = useWorkspace((s) => s.rootPath);

  const segments = useMemo(() => {
    if (!activeTabId) return null;
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab?.path) return null;
    let rel = tab.path;
    if (rootPath && rel.startsWith(rootPath)) {
      rel = rel.slice(rootPath.length).replace(/^[\\/]/, "");
    }
    const parts = rel.split(/[\\/]/).filter(Boolean);
    if (parts.length === 0) return null;
    return parts;
  }, [activeTabId, tabs, rootPath]);

  if (!segments) return null;

  return (
    <nav className="daisu-breadcrumb" aria-label="Ruta del archivo">
      {segments.map((s, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={`${s}-${i}`} className="daisu-breadcrumb-row">
            {i > 0 && (
              <span className="daisu-breadcrumb-sep" aria-hidden="true">·</span>
            )}
            <span
              className={
                isLast
                  ? "daisu-breadcrumb-segment daisu-breadcrumb-segment-leaf"
                  : "daisu-breadcrumb-segment"
              }
            >
              {s}
            </span>
          </span>
        );
      })}
    </nav>
  );
}
