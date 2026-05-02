import type { JSX } from "react";
import { useWorkspace } from "../../stores/workspaceStore";

export function Sidebar(): JSX.Element {
  const rootPath = useWorkspace((s) => s.rootPath);

  return (
    <aside className="daisu-sidebar" aria-label="Workspace explorer">
      <div className="daisu-sidebar-header">EXPLORER</div>
      <div className="daisu-sidebar-body">
        {rootPath
          ? <p className="daisu-empty-state">File tree arrives in Phase 2.</p>
          : <p className="daisu-empty-state">No folder open.</p>}
      </div>
    </aside>
  );
}
