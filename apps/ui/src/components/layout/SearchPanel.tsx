import type { JSX } from "react";
import { useUI } from "../../stores/uiStore";
import { Icon } from "../ui/Icon";

export function SearchPanel(): JSX.Element {
  const open = useUI((s) => s.searchPanelOpen);
  const toggle = useUI((s) => s.toggleSearchPanel);
  if (!open) return <></>;

  return (
    <section className="daisu-search-panel" aria-label="Search panel">
      <div className="daisu-search-header">
        <span>SEARCH</span>
        <button
          type="button"
          className="daisu-icon-btn"
          onClick={toggle}
          aria-label="Close search panel"
        >
          <Icon name="close" />
        </button>
      </div>
      <p className="daisu-empty-state">Workspace search arrives in Phase 5.</p>
    </section>
  );
}
