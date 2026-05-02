import type { JSX } from "react";

export function AgentsPanel(): JSX.Element {
  return (
    <aside className="daisu-agents-panel" aria-label="Agents panel">
      <div className="daisu-sidebar-header">AGENTS</div>
      <div className="daisu-empty-state">
        <p>Agents arrive in M4. Configure providers in Settings → AI Providers.</p>
      </div>
    </aside>
  );
}
