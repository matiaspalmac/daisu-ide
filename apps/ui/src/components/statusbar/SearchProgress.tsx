import type { JSX } from "react";
import { useSearch } from "../../stores/searchStore";
import { useUI } from "../../stores/uiStore";

export function SearchProgress(): JSX.Element | null {
  const active = useSearch((s) => s.activeRequestId);
  const filesSearched = useSearch((s) => s.filesSearched);
  const hits = useSearch((s) => s.hits.length);
  const done = useSearch((s) => s.done);
  const toggleSearch = useUI((s) => s.toggleSearchPanel);

  if (!active && !done) return null;
  if (done && hits === 0) return null;

  const label = active
    ? `Searching ${filesSearched} files... ${hits} hit${hits === 1 ? "" : "s"}`
    : `${hits} hit${hits === 1 ? "" : "s"} in ${filesSearched} files`;

  return (
    <button
      type="button"
      className="daisu-status-segment daisu-status-clickable"
      onClick={() => toggleSearch()}
      title="Toggle search panel"
    >
      {label}
    </button>
  );
}
