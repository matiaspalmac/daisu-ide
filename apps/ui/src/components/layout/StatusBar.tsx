import type { JSX } from "react";
import { useTabs } from "../../stores/tabsStore";
import { useWorkspace } from "../../stores/workspaceStore";

export function StatusBar(): JSX.Element {
  const activeTabId = useTabs((s) => s.activeTabId);
  const tab = useTabs((s) => s.tabs.find((t) => t.id === activeTabId) ?? null);
  const rootPath = useWorkspace((s) => s.rootPath);

  return (
    <footer className="daisu-statusbar" aria-label="Status bar">
      <div className="daisu-statusbar-left">
        {rootPath && <span className="daisu-status-item">{rootPath.split(/[\\/]/).pop()}</span>}
      </div>
      <div className="daisu-statusbar-right">
        {tab ? (
          <>
            <span className="daisu-status-item">UTF-8</span>
            <span className="daisu-status-item">{tab.language}</span>
          </>
        ) : (
          <span className="daisu-status-item">No file open</span>
        )}
      </div>
    </footer>
  );
}
